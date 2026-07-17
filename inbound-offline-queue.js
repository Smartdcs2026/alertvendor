/**
 * inbound-offline-queue.js
 * Phase 2A — Durable Inbound Pending Queue
 *
 * เป้าหมาย:
 * - เก็บงาน Workflow ที่ยังยืนยันผลไม่ได้ไว้ในเครื่องแบบ Durable
 * - Retry ด้วย requestId เดิม เพื่อให้ Backend Idempotency ป้องกันการเขียนซ้ำ
 * - ไม่เก็บ Access Token หรือ Secret ลง IndexedDB/localStorage
 * - ผูกงานกับผู้ใช้งานที่สร้างรายการ ป้องกันบัญชีอื่นส่งงานแทน
 * - ใช้ IndexedDB เป็นหลัก และ fallback เป็น localStorage เมื่อ Browser ปิด IndexedDB
 */
(function (window) {
  'use strict';

  const VERSION = '2026.07.17-round2-inbound-unknown-commit-reconcile';
  const DB_NAME = 'alertvendor_inbound_pending_queue_v2';
  const DB_VERSION = 1;
  const STORE_NAME = 'operations';
  const FALLBACK_STORAGE_KEY = 'ALERT_VENDOR_INBOUND_PENDING_QUEUE_V2';
  const LEASE_STORAGE_KEY = 'ALERT_VENDOR_INBOUND_QUEUE_LEASE_V2';

  const STATUS = Object.freeze({
    PENDING: 'PENDING',
    SENDING: 'SENDING',
    RETRY_WAIT: 'RETRY_WAIT',
    UNKNOWN: 'UNKNOWN',
    FAILED: 'FAILED',
    PAUSED_AUTH: 'PAUSED_AUTH',
    PAUSED_ACTOR: 'PAUSED_ACTOR',
    COMMITTED: 'COMMITTED'
  });

  const KIND = Object.freeze({
    RESOLVE_SCAN: 'RESOLVE_SCAN',
    SUBMIT_DOCUMENT: 'SUBMIT_DOCUMENT',
    RETURN_DOCUMENT: 'RETURN_DOCUMENT',
    CANCEL_STAGE: 'CANCEL_STAGE'
  });

  const ACTIVE_DEDUPE_STATUSES = new Set([
    STATUS.PENDING,
    STATUS.SENDING,
    STATUS.RETRY_WAIT,
    STATUS.UNKNOWN,
    STATUS.PAUSED_AUTH,
    STATUS.PAUSED_ACTOR,
    STATUS.FAILED
  ]);

  const TRANSIENT_CODES = new Set([
    'NETWORK_ERROR',
    'REQUEST_TIMEOUT',
    'GAS_TIMEOUT',
    'GAS_CONNECTION_FAILED',
    'GAS_HTTP_ERROR',
    'GAS_INVALID_RESPONSE',
    'UPSTREAM_TIMEOUT',
    'SERVICE_UNAVAILABLE',
    'TOO_MANY_REQUESTS',
    'WORKER_INTERNAL_ERROR',
    'API_ERROR'
  ]);

  const AUTH_CODES = new Set([
    'AUTH_REQUIRED',
    'SESSION_EXPIRED',
    'INVALID_SESSION',
    'INVALID_SESSION_SIGNATURE',
    'INVALID_SESSION_PAYLOAD',
    'SESSION_VERSION_EXPIRED',
    'MUST_CHANGE_PASSWORD'
  ]);

  const DUPLICATE_OR_ADVANCED_CODES = new Set([
    'DOCUMENT_ALREADY_SUBMITTED',
    'DOCUMENT_ALREADY_RETURNED',
    'RECEIVING_ALREADY_COMPLETED',
    'WORKFLOW_STAGE_ORDER_INVALID',
    'WORKFLOW_ALREADY_GATE_OUT',
    'WORKFLOW_ALREADY_CANCELLED',
    'INBOUND_CANCEL_ALREADY_CANCELLED',
    'INBOUND_CANCEL_NO_INBOUND_STAGE'
  ]);

  const state = {
    initialized: false,
    api: null,
    getActor: null,
    adapter: null,
    adapterMode: '',
    listeners: new Set(),
    flushPromise: null,
    autoFlushTimer: 0,
    instanceId: createUuid(),
    config: {
      maxItems: 500,
      maxAttempts: 12,
      retryBaseMs: 3000,
      retryMaxMs: 5 * 60 * 1000,
      autoFlushMs: 15000,
      sendingStaleMs: 2 * 60 * 1000,
      committedRetentionMs: 24 * 60 * 60 * 1000,
      failedRetentionMs: 7 * 24 * 60 * 60 * 1000,
      leaseMs: 45000,
      maxBatch: 30
    }
  };

  class QueueError extends Error {
    constructor(code, message, details) {
      super(message || code || 'Queue error');
      this.name = 'InboundQueueError';
      this.code = code || 'INBOUND_QUEUE_ERROR';
      this.details = details || null;
    }
  }

  /************************************************************
   * Public API
   ************************************************************/

  const service = {
    VERSION,
    STATUS,
    KIND,
    QueueError,

    async init(options) {
      const config = isObject(options) ? options : {};

      if (!config.api) {
        throw new QueueError(
          'QUEUE_API_REQUIRED',
          'ไม่พบ VehicleAPI สำหรับระบบรอส่ง'
        );
      }

      state.api = config.api;
      state.getActor = typeof config.getActor === 'function'
        ? config.getActor
        : function () { return null; };

      state.config = Object.assign(
        {},
        state.config,
        normalizeConfig(config.config || {})
      );

      state.adapter = await createAdapter();
      state.adapterMode = state.adapter.mode;
      state.initialized = true;

      await recoverInterruptedOperations();
      await cleanupExpiredOperations();
      await emitChange();

      return {
        success: true,
        version: VERSION,
        storageMode: state.adapterMode,
        initializedAt: new Date().toISOString()
      };
    },

    subscribe(listener) {
      if (typeof listener !== 'function') {
        return function () {};
      }

      state.listeners.add(listener);

      return function unsubscribe() {
        state.listeners.delete(listener);
      };
    },

    async enqueueResolveScan(moduleId, autoId, payload) {
      return enqueueOperation({
        kind: KIND.RESOLVE_SCAN,
        moduleId,
        autoId,
        payload
      });
    },

    async enqueueSubmitDocument(moduleId, autoId, payload) {
      return enqueueOperation({
        kind: KIND.SUBMIT_DOCUMENT,
        moduleId,
        autoId,
        payload
      });
    },

    async enqueueReturnDocument(moduleId, autoId, payload) {
      return enqueueOperation({
        kind: KIND.RETURN_DOCUMENT,
        moduleId,
        autoId,
        payload
      });
    },

    async enqueueCancelStage(moduleId, autoId, payload) {
      return enqueueOperation({
        kind: KIND.CANCEL_STAGE,
        moduleId,
        autoId,
        payload
      });
    },

    async flush(options) {
      ensureInitialized();

      if (state.flushPromise) {
        return state.flushPromise;
      }

      const config = isObject(options) ? options : {};
      state.flushPromise = flushInternal(config)
        .finally(function () {
          state.flushPromise = null;
        });

      return state.flushPromise;
    },

    async retryAll(options) {
      ensureInitialized();
      const config = isObject(options) ? options : {};
      const moduleId = cleanText(config.moduleId);
      const actor = currentActor();
      const operations = await state.adapter.getAll();
      let updated = 0;

      for (const operation of operations) {
        if (moduleId && normalizeModuleId(operation.moduleId) !== normalizeModuleId(moduleId)) {
          continue;
        }

        if (![
          STATUS.FAILED,
          STATUS.UNKNOWN,
          STATUS.RETRY_WAIT,
          STATUS.PAUSED_AUTH,
          STATUS.PAUSED_ACTOR
        ].includes(operation.status)) {
          continue;
        }

        if (operation.actorUsername && actor.username && operation.actorUsername !== actor.username) {
          continue;
        }

        operation.status = STATUS.PENDING;
        operation.nextAttemptAt = 0;
        operation.updatedAt = Date.now();
        operation.lastError = null;
        operation.manualRetryCount = Number(operation.manualRetryCount || 0) + 1;
        await state.adapter.put(operation);
        updated += 1;
      }

      await emitChange();

      if (config.flush !== false) {
        await service.flush({ force: true, moduleId });
      }

      return {
        success: true,
        updated
      };
    },

    async list(options) {
      ensureInitialized();
      const config = isObject(options) ? options : {};
      const moduleId = cleanText(config.moduleId);
      const statuses = Array.isArray(config.statuses)
        ? new Set(config.statuses.map(normalizeStatus))
        : null;
      const operations = await state.adapter.getAll();

      return operations
        .filter(function (operation) {
          if (moduleId && normalizeModuleId(operation.moduleId) !== normalizeModuleId(moduleId)) {
            return false;
          }

          if (statuses && !statuses.has(operation.status)) {
            return false;
          }

          return true;
        })
        .sort(function (left, right) {
          return Number(left.createdAt || 0) - Number(right.createdAt || 0);
        })
        .map(publicOperation);
    },

    async getSummary(options) {
      ensureInitialized();
      return buildSummary(options);
    },

    async removeFailed(operationId) {
      ensureInitialized();
      const operation = await state.adapter.get(cleanText(operationId));

      if (!operation) {
        return { success: true, removed: false };
      }

      if (![STATUS.FAILED, STATUS.COMMITTED].includes(operation.status)) {
        throw new QueueError(
          'QUEUE_OPERATION_NOT_REMOVABLE',
          'ลบได้เฉพาะรายการที่ล้มเหลวหรือส่งสำเร็จแล้ว'
        );
      }

      await state.adapter.delete(operation.id);
      await emitChange();

      return { success: true, removed: true };
    },

    async clearCommitted() {
      ensureInitialized();
      const operations = await state.adapter.getAll();
      let removed = 0;

      for (const operation of operations) {
        if (operation.status === STATUS.COMMITTED) {
          await state.adapter.delete(operation.id);
          removed += 1;
        }
      }

      await emitChange();
      return { success: true, removed };
    },

    startAutoFlush() {
      ensureInitialized();
      service.stopAutoFlush();

      const intervalMs = Math.max(5000, Number(state.config.autoFlushMs) || 15000);
      state.autoFlushTimer = window.setInterval(function () {
        if (window.navigator && window.navigator.onLine === false) {
          return;
        }

        void service.flush({ reason: 'AUTO_TIMER' });
      }, intervalMs);

      return { success: true, intervalMs };
    },

    stopAutoFlush() {
      if (state.autoFlushTimer) {
        window.clearInterval(state.autoFlushTimer);
        state.autoFlushTimer = 0;
      }
    },

    isTransientError,
    isAuthError,
    createRequestId: createUuid,
    getStorageMode: function () { return state.adapterMode; }
  };

  /************************************************************
   * Enqueue
   ************************************************************/

  async function enqueueOperation(input) {
    ensureInitialized();

    const kind = normalizeKind(input.kind);
    const moduleId = cleanText(input.moduleId);
    const autoId = normalizeAutoId(input.autoId);
    const payload = isObject(input.payload) ? Object.assign({}, input.payload) : {};
    const actor = currentActor();

    if (!moduleId) {
      throw new QueueError('MODULE_ID_REQUIRED', 'กรุณาระบุ Module ก่อนเก็บงานรอส่ง');
    }

    if (!autoId) {
      throw new QueueError('AUTO_ID_REQUIRED', 'กรุณาระบุ Auto ID ก่อนเก็บงานรอส่ง');
    }

    if (!actor.username) {
      throw new QueueError('QUEUE_ACTOR_REQUIRED', 'ไม่พบผู้ใช้งานสำหรับผูกงานรอส่ง');
    }

    const dedupeKey = buildDedupeKey(moduleId, autoId);
    const all = await state.adapter.getAll();
    const existing = all
      .filter(function (operation) {
        return operation.dedupeKey === dedupeKey &&
          ACTIVE_DEDUPE_STATUSES.has(operation.status);
      })
      .sort(function (left, right) {
        return Number(right.updatedAt || 0) - Number(left.updatedAt || 0);
      })[0] || null;

    if (existing) {
      if (existing.status === STATUS.FAILED) {
        existing.kind = kind;
        existing.payload = mergePayload(existing.payload, payload);
        existing.status = STATUS.PENDING;
        existing.nextAttemptAt = 0;
        existing.updatedAt = Date.now();
        existing.lastError = null;
        existing.actorUsername = actor.username;
        existing.actorRole = actor.role;
        await state.adapter.put(existing);
        await emitChange();
        return {
          queued: true,
          revived: true,
          duplicate: false,
          operation: publicOperation(existing)
        };
      }

      return {
        queued: false,
        revived: false,
        duplicate: true,
        operation: publicOperation(existing)
      };
    }

    const now = Date.now();
    const requestId = cleanText(
      payload.clientRequestId ||
      payload.requestId ||
      createUuid()
    );

    payload.entryCode = cleanText(payload.entryCode || payload.autoId || autoId);
    payload.autoId = cleanText(payload.autoId || autoId);
    payload.clientRequestId = requestId;
    payload.requestId = requestId;

    const operation = {
      id: 'IQ-' + createUuid(),
      version: VERSION,
      kind,
      moduleId,
      autoId,
      dedupeKey,
      payload,
      clientRequestId: requestId,
      requestId,
      actorUsername: actor.username,
      actorRole: actor.role,
      status: STATUS.PENDING,
      attempts: 0,
      manualRetryCount: 0,
      createdAt: now,
      updatedAt: now,
      lastAttemptAt: 0,
      nextAttemptAt: 0,
      committedAt: 0,
      lastError: null,
      resultSummary: null,
      source: cleanText(payload.scanSource || payload.source || 'INBOUND')
    };

    await ensureCapacity();
    await state.adapter.put(operation);
    await emitChange();
    notifyOperation('QUEUED', operation, null);

    return {
      queued: true,
      revived: false,
      duplicate: false,
      operation: publicOperation(operation)
    };
  }

  /************************************************************
   * Flush
   ************************************************************/

  async function flushInternal(options) {
    const config = isObject(options) ? options : {};
    const force = config.force === true;
    const moduleId = cleanText(config.moduleId);

    if (window.navigator && window.navigator.onLine === false && !force) {
      const summary = await buildSummary({ moduleId });
      return {
        success: true,
        skipped: true,
        reason: 'OFFLINE',
        summary
      };
    }

    const lease = acquireLease();
    if (!lease.acquired) {
      return {
        success: true,
        skipped: true,
        reason: 'ANOTHER_TAB_FLUSHING',
        leaseOwner: lease.owner || ''
      };
    }

    const startedAt = Date.now();
    let processed = 0;
    let committed = 0;
    let failed = 0;
    let deferred = 0;

    try {
      await recoverInterruptedOperations();
      const operations = await state.adapter.getAll();
      const flushActor = currentActor();
      const due = operations
        .filter(function (operation) {
          if (moduleId && normalizeModuleId(operation.moduleId) !== normalizeModuleId(moduleId)) {
            return false;
          }

          if (![STATUS.PENDING, STATUS.RETRY_WAIT, STATUS.UNKNOWN, STATUS.PAUSED_AUTH, STATUS.PAUSED_ACTOR].includes(operation.status)) {
            return false;
          }

          if (
            operation.status === STATUS.PAUSED_ACTOR &&
            operation.actorUsername &&
            operation.actorUsername !== flushActor.username
          ) {
            return false;
          }

          if (
            operation.status === STATUS.PAUSED_AUTH &&
            !flushActor.username
          ) {
            return false;
          }

          if (!force && Number(operation.nextAttemptAt || 0) > Date.now()) {
            return false;
          }

          return true;
        })
        .sort(function (left, right) {
          return Number(left.createdAt || 0) - Number(right.createdAt || 0);
        })
        .slice(0, Math.max(1, Number(state.config.maxBatch) || 30));

      for (const operation of due) {
        renewLease();
        processed += 1;

        const actorCheck = validateActor(operation);
        if (!actorCheck.valid) {
          operation.status = actorCheck.status;
          operation.updatedAt = Date.now();
          operation.lastError = {
            code: actorCheck.code,
            message: actorCheck.message,
            at: Date.now()
          };
          await state.adapter.put(operation);
          deferred += 1;
          continue;
        }

        if (window.navigator && window.navigator.onLine === false && !force) {
          deferred += 1;
          break;
        }

        if (operation.status === STATUS.UNKNOWN) {
          const preflight = await reconcileUnknownOperation(operation);
          if (preflight.committed) {
            operation.status = STATUS.COMMITTED;
            operation.committedAt = Date.now();
            operation.updatedAt = operation.committedAt;
            operation.nextAttemptAt = 0;
            operation.lastError = null;
            operation.resultSummary = sanitizeResult(preflight.result);
            await state.adapter.put(operation);
            committed += 1;
            notifyOperation('COMMITTED',operation,preflight.result);
            continue;
          }
        }

        operation.status = STATUS.SENDING;
        operation.attempts = Number(operation.attempts || 0) + 1;
        operation.lastAttemptAt = Date.now();
        operation.updatedAt = Date.now();
        await state.adapter.put(operation);
        await emitChange();
        notifyOperation('SENDING', operation, null);

        try {
          const result = await executeOperation(operation);
          operation.status = STATUS.COMMITTED;
          operation.committedAt = Date.now();
          operation.updatedAt = operation.committedAt;
          operation.nextAttemptAt = 0;
          operation.lastError = null;
          operation.resultSummary = sanitizeResult(result);
          await state.adapter.put(operation);
          committed += 1;
          notifyOperation('COMMITTED', operation, result);
        } catch (error) {
          const reconciled = await tryReconcileAdvancedState(operation, error);

          if (reconciled.committed) {
            operation.status = STATUS.COMMITTED;
            operation.committedAt = Date.now();
            operation.updatedAt = operation.committedAt;
            operation.nextAttemptAt = 0;
            operation.lastError = null;
            operation.resultSummary = sanitizeResult(reconciled.result);
            await state.adapter.put(operation);
            committed += 1;
            notifyOperation('COMMITTED', operation, reconciled.result);
            continue;
          }

          const queueError = normalizeError(error);
          operation.lastError = queueError;
          operation.updatedAt = Date.now();

          if (isAuthError(error)) {
            operation.status = STATUS.PAUSED_AUTH;
            operation.nextAttemptAt = 0;
            deferred += 1;
          } else if (isTransientError(error)) {
            if (operation.attempts >= Number(state.config.maxAttempts || 12)) {
              operation.status = STATUS.FAILED;
              operation.nextAttemptAt = 0;
              operation.lastError = {
                code: 'RETRY_LIMIT_REACHED',
                message: 'ส่งซ้ำครบจำนวนที่กำหนดแล้ว ต้องกดส่งใหม่จากหน้ารอส่ง',
                originalCode: queueError.code,
                originalMessage: queueError.message,
                at: Date.now()
              };
              failed += 1;
              notifyOperation('FAILED', operation, error);
            } else {
              operation.status = isUnknownCommitError(error)
                ? STATUS.UNKNOWN
                : STATUS.RETRY_WAIT;
              operation.nextAttemptAt = Date.now() + calculateRetryDelay(operation.attempts);
              deferred += 1;
              notifyOperation('DEFERRED', operation, error);
            }
          } else {
            operation.status = STATUS.FAILED;
            operation.nextAttemptAt = 0;
            failed += 1;
            notifyOperation('FAILED', operation, error);
          }

          await state.adapter.put(operation);
        }
      }

      await cleanupExpiredOperations();
      const summary = await emitChange();

      return {
        success: failed === 0,
        skipped: false,
        processed,
        committed,
        failed,
        deferred,
        durationMs: Math.max(0, Date.now() - startedAt),
        summary
      };
    } finally {
      releaseLease();
    }
  }

  async function executeOperation(operation) {
    const payload = Object.assign({}, operation.payload || {}, {
      entryCode: operation.autoId,
      autoId: operation.autoId,
      clientRequestId: operation.clientRequestId,
      requestId: operation.requestId
    });

    if (operation.kind === KIND.RESOLVE_SCAN) {
      const lookup = await state.api.lookupInboundWorkflow(
        operation.moduleId,
        operation.autoId,
        {
          entryCode: operation.autoId,
          autoId: operation.autoId,
          lookupMethod: payload.lookupMethod || payload.method || 'QUEUE_REPLAY',
          method: payload.lookupMethod || payload.method || 'QUEUE_REPLAY',
          qrText: payload.qrText || operation.autoId,
          cacheBust: Date.now()
        }
      );

      const action = deriveWorkflowAction(lookup);
      const enrichedPayload = enrichPayloadFromLookup(payload, lookup);

      if (action === KIND.SUBMIT_DOCUMENT) {
        const result = await state.api.submitInboundDocument(
          operation.moduleId,
          Object.assign({}, enrichedPayload, {
            note: payload.note || 'ส่งซ้ำจากคิว Inbound หลังเครือข่ายกลับมา',
            scanSource: payload.scanSource || 'QUEUE_REPLAY'
          })
        );
        return { action, lookup, result };
      }

      if (action === KIND.RETURN_DOCUMENT) {
        const result = await state.api.returnInboundDocument(
          operation.moduleId,
          Object.assign({}, enrichedPayload, {
            note: payload.note || 'ส่งซ้ำจากคิว Inbound หลังเครือข่ายกลับมา',
            scanSource: payload.scanSource || 'QUEUE_REPLAY'
          })
        );
        return { action, lookup, result };
      }

      return {
        action: 'NO_WRITE_REQUIRED',
        noWrite: true,
        lookup
      };
    }

    if (operation.kind === KIND.SUBMIT_DOCUMENT) {
      return state.api.submitInboundDocument(operation.moduleId, payload);
    }

    if (operation.kind === KIND.RETURN_DOCUMENT) {
      return state.api.returnInboundDocument(operation.moduleId, payload);
    }

    if (operation.kind === KIND.CANCEL_STAGE) {
      return state.api.cancelInboundWorkflow(operation.moduleId, payload);
    }

    throw new QueueError(
      'QUEUE_KIND_NOT_SUPPORTED',
      'ไม่รองรับชนิดงานรอส่ง ' + operation.kind
    );
  }

  async function reconcileUnknownOperation(operation) {
    if (!operation || !state.api || typeof state.api.lookupInboundWorkflow !== 'function') {
      return { committed:false, result:null };
    }

    try {
      const lookup = await state.api.lookupInboundWorkflow(
        operation.moduleId,
        operation.autoId,
        {
          cacheBust: Date.now(),
          lookupMethod: 'QUEUE_UNKNOWN_COMMIT_VERIFY',
          clientRequestId: operation.clientRequestId,
          requestId: operation.requestId
        }
      );
      const publicLookup = unwrapLookup(lookup);
      const workflow = publicLookup.state || {};
      const record = publicLookup.record || {};
      const status = cleanText(workflow.statusCode).toUpperCase();

      if (operation.kind === KIND.SUBMIT_DOCUMENT) {
        const committed = Boolean(
          workflow.documentSubmittedAt ||
          ['DOCUMENT_SUBMITTED','RECEIVING_COMPLETED','DOCUMENT_RETURNED','GATE_OUT_COMPLETED'].includes(status)
        );
        return committed
          ? { committed:true, result:{ reconciled:true, lookup, noWrite:true } }
          : { committed:false, result:null };
      }

      if (operation.kind === KIND.RETURN_DOCUMENT) {
        const committed = Boolean(
          workflow.documentReturnedAt ||
          ['DOCUMENT_RETURNED','GATE_OUT_COMPLETED'].includes(status)
        );
        return committed
          ? { committed:true, result:{ reconciled:true, lookup, noWrite:true } }
          : { committed:false, result:null };
      }

      if (operation.kind === KIND.RESOLVE_SCAN) {
        const action = deriveWorkflowAction(lookup);
        return action === 'NO_WRITE_REQUIRED'
          ? { committed:true, result:{ reconciled:true, lookup, noWrite:true } }
          : { committed:false, result:null };
      }

      if (operation.kind === KIND.CANCEL_STAGE) {
        return workflow.cancelled || status === 'CANCELLED'
          ? { committed:true, result:{ reconciled:true, lookup, noWrite:true } }
          : { committed:false, result:null };
      }

      return { committed:false, result:null };
    } catch (error) {
      if (isAuthError(error)) throw error;
      return { committed:false, result:null };
    }
  }

  async function tryReconcileAdvancedState(operation, error) {
    const code = cleanText(error && error.code).toUpperCase();

    if (!DUPLICATE_OR_ADVANCED_CODES.has(code)) {
      return { committed: false, result: null };
    }

    if (operation.kind === KIND.CANCEL_STAGE && code === 'INBOUND_CANCEL_ALREADY_CANCELLED') {
      return {
        committed: true,
        result: {
          noWrite: true,
          message: 'รายการถูกยกเลิกแล้วก่อนการส่งซ้ำ'
        }
      };
    }

    try {
      const lookup = await state.api.lookupInboundWorkflow(
        operation.moduleId,
        operation.autoId,
        { cacheBust: Date.now(), lookupMethod: 'QUEUE_RECONCILE' }
      );
      const publicLookup = unwrapLookup(lookup);
      const workflow = publicLookup.state || {};
      const record = publicLookup.record || {};
      const status = cleanText(workflow.statusCode).toUpperCase();

      if (operation.kind === KIND.SUBMIT_DOCUMENT) {
        const advanced = Boolean(
          workflow.documentSubmittedAt ||
          ['DOCUMENT_SUBMITTED', 'RECEIVING_COMPLETED', 'DOCUMENT_RETURNED', 'GATE_OUT_COMPLETED'].includes(status) ||
          record.timestampOut ||
          workflow.gateOutAt ||
          workflow.cancelled
        );

        return advanced
          ? { committed: true, result: { noWrite: true, reconciled: true, lookup } }
          : { committed: false, result: null };
      }

      if (operation.kind === KIND.RETURN_DOCUMENT) {
        const advanced = Boolean(
          workflow.documentReturnedAt ||
          ['DOCUMENT_RETURNED', 'GATE_OUT_COMPLETED'].includes(status) ||
          record.timestampOut ||
          workflow.gateOutAt ||
          workflow.cancelled
        );

        return advanced
          ? { committed: true, result: { noWrite: true, reconciled: true, lookup } }
          : { committed: false, result: null };
      }

      if (operation.kind === KIND.RESOLVE_SCAN) {
        const action = deriveWorkflowAction(lookup);
        return action === 'NO_WRITE_REQUIRED'
          ? { committed: true, result: { noWrite: true, reconciled: true, lookup } }
          : { committed: false, result: null };
      }
    } catch (lookupError) {
      return { committed: false, result: null };
    }

    return { committed: false, result: null };
  }

  /************************************************************
   * Workflow helpers
   ************************************************************/

  function deriveWorkflowAction(input) {
    const lookup = unwrapLookup(input);
    const record = isObject(lookup.record) ? lookup.record : {};
    const workflow = isObject(lookup.state) ? lookup.state : {};
    const status = cleanText(workflow.statusCode).toUpperCase();

    if (!normalizeAutoId(record.autoId || lookup.autoId)) {
      return 'NO_WRITE_REQUIRED';
    }

    if (record.timestampOut || workflow.gateOutAt || workflow.cancelled || status === 'CANCELLED') {
      return 'NO_WRITE_REQUIRED';
    }

    if (
      !workflow.documentSubmittedAt &&
      !['DOCUMENT_SUBMITTED', 'RECEIVING_COMPLETED', 'DOCUMENT_RETURNED', 'GATE_OUT_COMPLETED'].includes(status)
    ) {
      return KIND.SUBMIT_DOCUMENT;
    }

    if (workflow.receivingCompletedAt && !workflow.documentReturnedAt) {
      return KIND.RETURN_DOCUMENT;
    }

    return 'NO_WRITE_REQUIRED';
  }

  function enrichPayloadFromLookup(payload, input) {
    const lookup = unwrapLookup(input);
    const record = isObject(lookup.record) ? lookup.record : {};

    return Object.assign({}, payload, {
      entryCode: normalizeAutoId(record.autoId || payload.entryCode || payload.autoId),
      autoId: normalizeAutoId(record.autoId || payload.autoId || payload.entryCode),
      canonicalRecordId: cleanText(record.canonicalRecordId || payload.canonicalRecordId),
      sourceRowNumber: Number(record.sourceRowNumber || payload.sourceRowNumber || 0) || '',
      expectedTimestampIn: cleanText(record.timestampIn || payload.expectedTimestampIn),
      expectedTimestampInEpochMs: Number(record.timestampInEpochMs || payload.expectedTimestampInEpochMs || 0) || '',
      expectedPrimaryValue: cleanText(record.primaryValue || payload.expectedPrimaryValue),
      clientRequestId: cleanText(payload.clientRequestId),
      requestId: cleanText(payload.requestId || payload.clientRequestId)
    });
  }

  function unwrapLookup(input) {
    if (isObject(input) && isObject(input.result)) {
      return unwrapLookup(input.result);
    }

    if (isObject(input) && isObject(input.lookup)) {
      return unwrapLookup(input.lookup);
    }

    if (isObject(input) && isObject(input.data) && !input.record && !input.state) {
      return unwrapLookup(input.data);
    }

    return isObject(input) ? input : {};
  }

  /************************************************************
   * Recovery / Cleanup / Summary
   ************************************************************/

  async function recoverInterruptedOperations() {
    if (!state.adapter) {
      return;
    }

    const operations = await state.adapter.getAll();
    const now = Date.now();

    for (const operation of operations) {
      if (
        operation.status === STATUS.SENDING &&
        now - Number(operation.lastAttemptAt || operation.updatedAt || 0) >= Number(state.config.sendingStaleMs || 120000)
      ) {
        operation.status = STATUS.UNKNOWN;
        operation.nextAttemptAt = now;
        operation.updatedAt = now;
        operation.lastError = {
          code: 'INTERRUPTED_DURING_SEND',
          message: 'หน้าเว็บถูกปิดหรือรีโหลดระหว่างส่ง ระบบจะตรวจซ้ำด้วย requestId เดิม',
          at: now
        };
        await state.adapter.put(operation);
      }
    }
  }

  async function cleanupExpiredOperations() {
    if (!state.adapter) {
      return;
    }

    const operations = await state.adapter.getAll();
    const now = Date.now();

    for (const operation of operations) {
      const age = now - Number(operation.updatedAt || operation.createdAt || now);

      if (
        operation.status === STATUS.COMMITTED &&
        age >= Number(state.config.committedRetentionMs)
      ) {
        await state.adapter.delete(operation.id);
        continue;
      }

      if (
        operation.status === STATUS.FAILED &&
        age >= Number(state.config.failedRetentionMs)
      ) {
        await state.adapter.delete(operation.id);
      }
    }
  }

  async function ensureCapacity() {
    const operations = await state.adapter.getAll();
    const maximum = Math.max(20, Number(state.config.maxItems) || 500);

    if (operations.length < maximum) {
      return;
    }

    const removable = operations
      .filter(function (operation) {
        return [STATUS.COMMITTED, STATUS.FAILED].includes(operation.status);
      })
      .sort(function (left, right) {
        return Number(left.updatedAt || 0) - Number(right.updatedAt || 0);
      });

    while (operations.length >= maximum && removable.length > 0) {
      const operation = removable.shift();
      await state.adapter.delete(operation.id);
      operations.splice(operations.indexOf(operation), 1);
    }

    if (operations.length >= maximum) {
      throw new QueueError(
        'QUEUE_CAPACITY_REACHED',
        'คิวรอส่งเต็ม กรุณาเชื่อมต่ออินเทอร์เน็ตและส่งรายการค้างก่อนสแกนต่อ',
        { maximum }
      );
    }
  }

  async function buildSummary(options) {
    const config = isObject(options) ? options : {};
    const moduleId = cleanText(config.moduleId);
    const operations = await state.adapter.getAll();
    const filtered = operations.filter(function (operation) {
      return !moduleId || normalizeModuleId(operation.moduleId) === normalizeModuleId(moduleId);
    });

    const counts = {};
    Object.keys(STATUS).forEach(function (key) {
      counts[STATUS[key]] = 0;
    });

    filtered.forEach(function (operation) {
      counts[operation.status] = Number(counts[operation.status] || 0) + 1;
    });

    const pending =
      counts[STATUS.PENDING] +
      counts[STATUS.SENDING] +
      counts[STATUS.RETRY_WAIT] +
      counts[STATUS.UNKNOWN];

    const paused = counts[STATUS.PAUSED_AUTH] + counts[STATUS.PAUSED_ACTOR];

    return {
      version: VERSION,
      storageMode: state.adapterMode,
      total: filtered.length,
      pending,
      failed: counts[STATUS.FAILED],
      paused,
      committed: counts[STATUS.COMMITTED],
      counts,
      online: !(window.navigator && window.navigator.onLine === false),
      oldestPendingAt: oldestPendingAt(filtered),
      checkedAt: new Date().toISOString()
    };
  }

  async function emitChange() {
    if (!state.initialized || !state.adapter) {
      return null;
    }

    const summary = await buildSummary({});

    state.listeners.forEach(function (listener) {
      try {
        listener(summary);
      } catch (error) {
        console.warn('Inbound queue listener failed', error);
      }
    });

    try {
      window.dispatchEvent(new CustomEvent('inboundqueuechange', {
        detail: summary
      }));
    } catch (error) {}

    return summary;
  }

  function notifyOperation(type, operation, resultOrError) {
    try {
      window.dispatchEvent(new CustomEvent('inboundqueueoperation', {
        detail: {
          type,
          operation: publicOperation(operation),
          result: type === 'COMMITTED' ? resultOrError : null,
          error: type === 'FAILED' || type === 'DEFERRED'
            ? normalizeError(resultOrError)
            : null
        }
      }));
    } catch (error) {}
  }

  /************************************************************
   * Actor / Error / Retry
   ************************************************************/

  function currentActor() {
    const actor = typeof state.getActor === 'function'
      ? state.getActor()
      : null;
    const source = isObject(actor) ? actor : {};

    return {
      username: cleanText(source.username || source.actorUsername),
      role: cleanText(source.role || source.viewerRole).toUpperCase()
    };
  }

  function validateActor(operation) {
    const actor = currentActor();

    if (!actor.username) {
      return {
        valid: false,
        status: STATUS.PAUSED_AUTH,
        code: 'QUEUE_CURRENT_ACTOR_MISSING',
        message: 'รอเข้าสู่ระบบก่อนส่งรายการค้าง'
      };
    }

    if (operation.actorUsername && operation.actorUsername !== actor.username) {
      return {
        valid: false,
        status: STATUS.PAUSED_ACTOR,
        code: 'QUEUE_ACTOR_MISMATCH',
        message: 'รายการนี้ถูกสร้างโดย ' + operation.actorUsername + ' ต้องเข้าสู่ระบบด้วยบัญชีเดิมเพื่อส่ง'
      };
    }

    return { valid: true };
  }

  function isTransientError(error) {
    const code = cleanText(error && error.code).toUpperCase();
    const status = Number(error && error.status) || 0;

    if (TRANSIENT_CODES.has(code)) {
      return true;
    }

    return [0, 408, 425, 429, 500, 502, 503, 504].includes(status);
  }

  function isAuthError(error) {
    const code = cleanText(error && error.code).toUpperCase();
    const status = Number(error && error.status) || 0;
    return status === 401 || AUTH_CODES.has(code);
  }

  function isUnknownCommitError(error) {
    const code = cleanText(error && error.code).toUpperCase();
    const status = Number(error && error.status) || 0;
    return ['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'GAS_TIMEOUT', 'GAS_CONNECTION_FAILED'].includes(code) ||
      [0, 408, 502, 504].includes(status);
  }

  function normalizeError(error) {
    return {
      code: cleanText(error && error.code) || 'QUEUE_SEND_FAILED',
      message: cleanText(error && error.message) || String(error || 'ส่งรายการไม่สำเร็จ'),
      status: Number(error && error.status) || 0,
      requestId: cleanText(error && error.requestId),
      at: Date.now()
    };
  }

  function calculateRetryDelay(attempts) {
    const base = Math.max(1000, Number(state.config.retryBaseMs) || 3000);
    const maximum = Math.max(base, Number(state.config.retryMaxMs) || 300000);
    const exponent = Math.max(0, Number(attempts || 1) - 1);
    const raw = Math.min(maximum, base * Math.pow(2, exponent));
    const jitter = raw * (Math.random() * 0.3);
    return Math.floor(raw + jitter);
  }

  /************************************************************
   * Lease
   ************************************************************/

  function acquireLease() {
    const now = Date.now();
    const leaseMs = Math.max(15000, Number(state.config.leaseMs) || 45000);

    try {
      const current = JSON.parse(window.localStorage.getItem(LEASE_STORAGE_KEY) || 'null');

      if (
        current &&
        current.owner &&
        current.owner !== state.instanceId &&
        Number(current.expiresAt || 0) > now
      ) {
        return { acquired: false, owner: current.owner };
      }

      const next = {
        owner: state.instanceId,
        expiresAt: now + leaseMs
      };
      window.localStorage.setItem(LEASE_STORAGE_KEY, JSON.stringify(next));
      const verify = JSON.parse(window.localStorage.getItem(LEASE_STORAGE_KEY) || 'null');
      return {
        acquired: Boolean(verify && verify.owner === state.instanceId),
        owner: verify && verify.owner
      };
    } catch (error) {
      return { acquired: true, owner: state.instanceId, fallback: true };
    }
  }

  function renewLease() {
    try {
      window.localStorage.setItem(LEASE_STORAGE_KEY, JSON.stringify({
        owner: state.instanceId,
        expiresAt: Date.now() + Math.max(15000, Number(state.config.leaseMs) || 45000)
      }));
    } catch (error) {}
  }

  function releaseLease() {
    try {
      const current = JSON.parse(window.localStorage.getItem(LEASE_STORAGE_KEY) || 'null');
      if (current && current.owner === state.instanceId) {
        window.localStorage.removeItem(LEASE_STORAGE_KEY);
      }
    } catch (error) {}
  }

  /************************************************************
   * Storage adapters
   ************************************************************/

  async function createAdapter() {
    if (window.indexedDB) {
      try {
        const db = await openDatabase();
        return indexedDbAdapter(db);
      } catch (error) {
        console.warn('IndexedDB unavailable, using localStorage queue', error);
      }
    }

    return localStorageAdapter();
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        const db = event.target.result;
        let store;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        } else {
          store = event.target.transaction.objectStore(STORE_NAME);
        }

        ensureIndex(store, 'status', 'status');
        ensureIndex(store, 'dedupeKey', 'dedupeKey');
        ensureIndex(store, 'moduleId', 'moduleId');
        ensureIndex(store, 'nextAttemptAt', 'nextAttemptAt');
        ensureIndex(store, 'createdAt', 'createdAt');
      };

      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onerror = function () {
        reject(request.error || new Error('open IndexedDB failed'));
      };

      request.onblocked = function () {
        reject(new Error('IndexedDB upgrade blocked'));
      };
    });
  }

  function ensureIndex(store, name, keyPath) {
    if (!store.indexNames.contains(name)) {
      store.createIndex(name, keyPath, { unique: false });
    }
  }

  function indexedDbAdapter(db) {
    return {
      mode: 'INDEXED_DB',
      get: function (id) {
        return idbRequest(db, 'readonly', function (store) {
          return store.get(id);
        });
      },
      getAll: function () {
        return idbRequest(db, 'readonly', function (store) {
          return store.getAll();
        }).then(function (result) {
          return Array.isArray(result) ? result : [];
        });
      },
      put: function (operation) {
        return idbRequest(db, 'readwrite', function (store) {
          return store.put(operation);
        }).then(function () { return operation; });
      },
      delete: function (id) {
        return idbRequest(db, 'readwrite', function (store) {
          return store.delete(id);
        });
      }
    };
  }

  function idbRequest(db, mode, requestFactory) {
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let request;
      let result;
      let settled = false;

      function fail(error) {
        if (settled) return;
        settled = true;
        reject(error);
      }

      try {
        request = requestFactory(store);
      } catch (error) {
        fail(error);
        return;
      }

      request.onsuccess = function () {
        result = request.result;
      };

      request.onerror = function () {
        fail(request.error || transaction.error || new Error('IndexedDB request failed'));
      };

      transaction.oncomplete = function () {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      transaction.onerror = function () {
        fail(transaction.error || new Error('IndexedDB transaction failed'));
      };

      transaction.onabort = function () {
        fail(transaction.error || new Error('IndexedDB transaction aborted'));
      };
    });
  }

  function localStorageAdapter() {
    function readAll() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(FALLBACK_STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }

    function writeAll(items) {
      window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(items));
    }

    return {
      mode: 'LOCAL_STORAGE_FALLBACK',
      get: async function (id) {
        return readAll().find(function (item) { return item.id === id; }) || null;
      },
      getAll: async function () {
        return readAll();
      },
      put: async function (operation) {
        const items = readAll();
        const index = items.findIndex(function (item) { return item.id === operation.id; });
        if (index >= 0) items[index] = operation;
        else items.push(operation);
        writeAll(items);
        return operation;
      },
      delete: async function (id) {
        writeAll(readAll().filter(function (item) { return item.id !== id; }));
      }
    };
  }

  /************************************************************
   * Generic helpers
   ************************************************************/

  function ensureInitialized() {
    if (!state.initialized || !state.adapter) {
      throw new QueueError(
        'QUEUE_NOT_INITIALIZED',
        'ระบบรอส่งยังไม่พร้อมใช้งาน'
      );
    }
  }

  function normalizeConfig(config) {
    const source = isObject(config) ? config : {};
    const result = {};

    const numericKeys = [
      'maxItems',
      'maxAttempts',
      'retryBaseMs',
      'retryMaxMs',
      'autoFlushMs',
      'sendingStaleMs',
      'committedRetentionMs',
      'failedRetentionMs',
      'leaseMs',
      'maxBatch'
    ];

    numericKeys.forEach(function (key) {
      const value = Number(source[key]);
      if (Number.isFinite(value) && value > 0) {
        result[key] = Math.floor(value);
      }
    });

    return result;
  }

  function normalizeKind(value) {
    const kind = cleanText(value).toUpperCase();
    if (!Object.values(KIND).includes(kind)) {
      throw new QueueError('QUEUE_KIND_INVALID', 'ชนิดงานรอส่งไม่ถูกต้อง: ' + kind);
    }
    return kind;
  }

  function normalizeStatus(value) {
    const status = cleanText(value).toUpperCase();
    return Object.values(STATUS).includes(status) ? status : STATUS.PENDING;
  }

  function buildDedupeKey(moduleId, autoId) {
    return normalizeModuleId(moduleId) + '|' + normalizeAutoId(autoId);
  }

  function normalizeModuleId(value) {
    return cleanText(value).toLowerCase();
  }

  function normalizeAutoId(value) {
    return cleanText(value).replace(/\s+/g, '').toUpperCase();
  }

  function mergePayload(left, right) {
    return Object.assign({}, isObject(left) ? left : {}, isObject(right) ? right : {});
  }

  function publicOperation(operation) {
    return {
      id: operation.id,
      kind: operation.kind,
      moduleId: operation.moduleId,
      autoId: operation.autoId,
      status: operation.status,
      attempts: Number(operation.attempts || 0),
      manualRetryCount: Number(operation.manualRetryCount || 0),
      createdAt: Number(operation.createdAt || 0),
      updatedAt: Number(operation.updatedAt || 0),
      lastAttemptAt: Number(operation.lastAttemptAt || 0),
      nextAttemptAt: Number(operation.nextAttemptAt || 0),
      committedAt: Number(operation.committedAt || 0),
      actorUsername: operation.actorUsername || '',
      actorRole: operation.actorRole || '',
      source: operation.source || '',
      clientRequestId: operation.clientRequestId || '',
      lastError: operation.lastError || null,
      resultSummary: operation.resultSummary || null
    };
  }

  function sanitizeResult(input) {
    const source = isObject(input) ? input : {};
    const lookup = unwrapLookup(source);
    const record = isObject(lookup.record) ? lookup.record : {};
    const workflow = isObject(lookup.state) ? lookup.state : {};

    return {
      action: cleanText(source.action || source.mode || lookup.mode),
      noWrite: source.noWrite === true || lookup.noWrite === true,
      message: cleanText(source.message || lookup.message),
      autoId: normalizeAutoId(record.autoId),
      statusCode: cleanText(workflow.statusCode),
      documentSubmittedAt: cleanText(workflow.documentSubmittedAt),
      receivingCompletedAt: cleanText(workflow.receivingCompletedAt),
      documentReturnedAt: cleanText(workflow.documentReturnedAt),
      gateOutAt: cleanText(workflow.gateOutAt || record.timestampOut)
    };
  }

  function oldestPendingAt(operations) {
    const candidates = operations
      .filter(function (operation) {
        return [STATUS.PENDING, STATUS.SENDING, STATUS.RETRY_WAIT, STATUS.UNKNOWN].includes(operation.status);
      })
      .map(function (operation) { return Number(operation.createdAt || 0); })
      .filter(function (value) { return value > 0; });

    return candidates.length ? Math.min.apply(null, candidates) : 0;
  }

  function createUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (character) {
      const random = Math.random() * 16 | 0;
      const value = character === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }

  function cleanText(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  window.InboundPendingQueue = service;
})(window);
