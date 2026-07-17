/**
 * api.js
 * ROUND 3 REVISION 4 HOTFIX — Module Route Session Isolation
 * ตัวกลางเรียก Cloudflare Worker API
 *
 * Session:
 * - เก็บ Signed Session Token ใน sessionStorage
 * - ส่งผ่าน Authorization: Bearer <token>
 * - ไม่พึ่ง Third-party Cookie ระหว่าง github.io กับ workers.dev
 * - Production R16: Phase 4E Revision-aware Inbound Dashboard
 */
(function (window) {
  'use strict';

  const CONFIG =
    window.APP_CONFIG || {};

  const API_BASE =
    String(
      CONFIG.API_BASE || ''
    ).replace(/\/+$/, '');

  const TOKEN_STORAGE_KEY =
    String(
      CONFIG.TOKEN_STORAGE_KEY ||
      'alertvendor_access_token_v2'
    ).trim() ||
    'alertvendor_access_token_v2';

  const LEGACY_TOKEN_STORAGE_KEYS =
    Object.freeze(
      [
        'alertvendor_access_token',
        'alertvendor_access_token_v1',
        'alertvendor_token',
        'alertvendorAccessToken',
        'access_token',
        'accessToken',
        'token',
        'sessionToken',
        'authToken',
        'vehicle_status_access_token',
        'vehicle_access_token'
      ].filter(
        (key) => key !== TOKEN_STORAGE_KEY
      )
    );

  const LEGACY_ROUTE_USER_KEYS =
    Object.freeze([
      'alertvendor_user',
      'alertvendor_current_user',
      'currentUser',
      'auth_user',
      'user',
      'vehicle_status_user',
      'alertvendor_session'
    ]);

  const LEGACY_ROUTE_FLAG_KEYS =
    Object.freeze([
      'vcw_inbound_only'
    ]);

  const inFlightGetRequests =
    new Map();

  const RETRYABLE_ERROR_CODES =
    new Set([
      'NETWORK_ERROR',
      'REQUEST_TIMEOUT',
      'GAS_TIMEOUT',
      'GAS_CONNECTION_FAILED',
      'GAS_HTTP_ERROR'
    ]);

  if (!API_BASE) {
    console.error(
      'ไม่พบ APP_CONFIG.API_BASE'
    );
  }

  class VehicleAPIError extends Error {
    constructor(
      message,
      code,
      status,
      details,
      requestId
    ) {
      super(
        message ||
        'เกิดข้อผิดพลาดในการเรียก API'
      );

      this.name =
        'VehicleAPIError';

      this.code =
        code ||
        'API_ERROR';

      this.status =
        Number(status) || 0;

      this.details =
        details || null;

      this.requestId =
        requestId || '';
    }
  }

  /************************************************************
   * Token Storage
   ************************************************************/

  function readStorageToken(
    storage,
    key
  ) {
    try {
      return String(
        storage.getItem(key) || ''
      ).trim();
    } catch (error) {
      return '';
    }
  }

  function removeStorageKey(
    storage,
    key
  ) {
    try {
      storage.removeItem(key);
    } catch (error) {
      /* Storage อาจถูก Browser Policy ปิดไว้ */
    }
  }

  function purgeLegacyRouteArtifacts(
    removeSessionLegacyTokens
  ) {
    const storages = [
      window.sessionStorage,
      window.localStorage
    ];

    storages.forEach((storage) => {
      LEGACY_ROUTE_USER_KEYS.forEach(
        (key) => removeStorageKey(storage, key)
      );

      LEGACY_ROUTE_FLAG_KEYS.forEach(
        (key) => removeStorageKey(storage, key)
      );
    });

    /*
     * Token รุ่นเก่าใน localStorage เป็นสาเหตุสำคัญที่ Route Guard รุ่นเก่า
     * อ่านบัญชี INBOUND ค้างจากรอบก่อน แล้วพา USER/ADMIN ไป inbound.html
     * ระบบปัจจุบันใช้เฉพาะ TOKEN_STORAGE_KEY ใน sessionStorage เท่านั้น
     */
    LEGACY_TOKEN_STORAGE_KEYS.forEach((key) => {
      removeStorageKey(window.localStorage, key);

      if (removeSessionLegacyTokens === true) {
        removeStorageKey(window.sessionStorage, key);
      }
    });
  }

  /* ล้างข้อมูล Role/Token รุ่นเก่าที่ไม่ใช่ Session ปัจจุบันทันที */
  purgeLegacyRouteArtifacts(false);

  function getAccessToken() {
    let token =
      readStorageToken(
        window.sessionStorage,
        TOKEN_STORAGE_KEY
      );

    if (token) {
      purgeLegacyRouteArtifacts(true);
      return token;
    }

    /*
     * ย้าย Session รุ่นเก่าเข้าสู่ key ปัจจุบันแบบครั้งเดียว
     * ไม่อ่านจาก localStorage เพื่อคงนโยบาย WINDOW_ISOLATED
     */
    for (const legacyKey of LEGACY_TOKEN_STORAGE_KEYS) {
      token =
        readStorageToken(
          window.sessionStorage,
          legacyKey
        );

      if (!token) {
        continue;
      }

      try {
        window.sessionStorage.setItem(
          TOKEN_STORAGE_KEY,
          token
        );
      } catch (error) {
        /* ใช้ token ที่อ่านได้ต่อ แม้ migrate ไม่สำเร็จ */
      }

      purgeLegacyRouteArtifacts(true);

      return token;
    }

    return '';
  }

  function setAccessToken(
    token
  ) {
    const cleanToken =
      String(
        token || ''
      ).trim();

    if (!cleanToken) {
      clearAccessToken();
      return;
    }

    try {
      window.sessionStorage
        .setItem(
          TOKEN_STORAGE_KEY,
          cleanToken
        );

      LEGACY_TOKEN_STORAGE_KEYS.forEach(
        (key) => removeStorageKey(
          window.sessionStorage,
          key
        )
      );

    } catch (error) {
      throw new VehicleAPIError(
        'เบราว์เซอร์ไม่อนุญาตให้บันทึก Session',
        'SESSION_STORAGE_FAILED',
        0,
        {
          originalMessage:
            error &&
            error.message
              ? error.message
              : String(error)
        }
      );
    }
  }

  function clearAccessToken() {
    const keys =
      [
        TOKEN_STORAGE_KEY,
        ...LEGACY_TOKEN_STORAGE_KEYS
      ];

    keys.forEach((key) => {
      removeStorageKey(
        window.sessionStorage,
        key
      );

      /* ล้างของเก่าที่อาจเคยถูกเก็บข้ามหน้าต่าง */
      removeStorageKey(
        window.localStorage,
        key
      );
    });

    inFlightGetRequests.clear();
  }

  function updateTokenFromData(
    data
  ) {
    const token =
      data &&
      data.accessToken
        ? String(
            data.accessToken
          ).trim()
        : '';

    if (token) {
      setAccessToken(
        token
      );
    }

    return token;
  }

  /************************************************************
   * Request helpers
   ************************************************************/

  function createRequestId() {
    if (
      window.crypto &&
      typeof window.crypto.randomUUID ===
        'function'
    ) {
      return window.crypto.randomUUID();
    }

    return (
      'req-' +
      Date.now().toString(36) +
      '-' +
      Math.random()
        .toString(36)
        .slice(2, 12)
    );
  }

  function buildUrl(
    path,
    query
  ) {
    const cleanPath =
      String(
        path || ''
      ).startsWith('/')
        ? String(path)
        : '/' + String(path || '');

    const url =
      new URL(
        API_BASE + cleanPath
      );

    if (
      query &&
      typeof query === 'object'
    ) {
      Object.entries(query)
        .forEach(
          ([key, value]) => {
            if (
              value === undefined ||
              value === null ||
              value === ''
            ) {
              return;
            }

            url.searchParams.set(
              key,
              String(value)
            );
          }
        );
    }

    return url.toString();
  }

  async function parseResponse(
    response
  ) {
    const text =
      await response.text();

    if (!text.trim()) {
      throw new VehicleAPIError(
        'API ไม่ได้ส่งข้อมูลกลับมา',
        'EMPTY_RESPONSE',
        response.status,
        null,
        response.headers.get(
          'X-Request-Id'
        ) || ''
      );
    }

    let payload;

    try {
      payload =
        JSON.parse(text);

    } catch (error) {
      throw new VehicleAPIError(
        'API ไม่ได้ส่ง JSON ที่ถูกต้องกลับมา',
        'INVALID_JSON_RESPONSE',
        response.status,
        {
          preview:
            text.slice(
              0,
              300
            )
        },
        response.headers.get(
          'X-Request-Id'
        ) || ''
      );
    }

    const requestId =
      String(
        payload.requestId ||
        response.headers.get(
          'X-Request-Id'
        ) ||
        ''
      );

    if (
      !response.ok ||
      payload.success !== true
    ) {
      const apiError =
        payload &&
        payload.error
          ? payload.error
          : {};

      if (
        response.status === 401 ||
        [
          'AUTH_REQUIRED',
          'SESSION_EXPIRED',
          'INVALID_SESSION',
          'INVALID_SESSION_SIGNATURE',
          'INVALID_SESSION_PAYLOAD',
          'SESSION_VERSION_EXPIRED'
        ].includes(
          apiError.code
        )
      ) {
        clearAccessToken();
      }

      throw new VehicleAPIError(
        apiError.message ||
        'เกิดข้อผิดพลาดจากระบบ',
        apiError.code ||
        'API_ERROR',
        response.status,
        apiError.details || null,
        requestId
      );
    }

    return payload;
  }

  async function request(
    path,
    options
  ) {
    const config =
      options &&
      typeof options === 'object'
        ? {
            ...options
          }
        : {};

    const method =
      String(
        config.method || 'GET'
      ).toUpperCase();

    const requestKey =
      method === 'GET' &&
      config.dedupe !== false
        ? buildUrl(
            path,
            config.query
          )
        : '';

    if (
      requestKey &&
      inFlightGetRequests.has(
        requestKey
      )
    ) {
      return inFlightGetRequests.get(
        requestKey
      );
    }

    const promise =
      requestWithRetry(
        path,
        config
      );

    if (requestKey) {
      inFlightGetRequests.set(
        requestKey,
        promise
      );
    }

    try {
      return await promise;

    } finally {
      if (requestKey) {
        inFlightGetRequests.delete(
          requestKey
        );
      }
    }
  }

  async function requestWithRetry(
    path,
    config
  ) {
    const method =
      String(
        config.method || 'GET'
      ).toUpperCase();

    const maximumRetries =
      method === 'GET'
        ? clampInteger(
            config.retries,
            0,
            3,
            2
          )
        : 0;

    let attempt = 0;

    while (true) {
      try {
        return await requestOnce(
          path,
          config
        );

      } catch (error) {
        if (
          attempt >=
            maximumRetries ||
          !shouldRetryRequest(
            error,
            method
          )
        ) {
          throw error;
        }

        const waitMs =
          calculateRetryDelayMs(
            error,
            attempt
          );

        await delay(waitMs);

        attempt += 1;
      }
    }
  }

  async function requestOnce(
    path,
    config
  ) {
    if (!API_BASE) {
      throw new VehicleAPIError(
        'ยังไม่ได้ตั้งค่า API_BASE',
        'API_BASE_MISSING',
        0
      );
    }

    const method =
      String(
        config.method || 'GET'
      ).toUpperCase();

    const useAuthentication =
      config.auth !== false;

    const timeoutMs =
      Math.max(
        5000,
        Number(
          config.timeoutMs ||
          CONFIG.API_TIMEOUT_MS ||
          60000
        )
      );

    const controller =
      new AbortController();

    const timeoutId =
      window.setTimeout(
        () => {
          controller.abort();
        },
        timeoutMs
      );

    const headers =
      new Headers(
        config.headers || {}
      );

    headers.set(
      'Accept',
      'application/json'
    );

    headers.set(
      'X-Request-Id',
      String(config.requestId || createRequestId())
    );

    if (useAuthentication) {
      const token =
        getAccessToken();

      if (token) {
        headers.set(
          'Authorization',
          'Bearer ' + token
        );
      }
    }

    const fetchOptions = {
      method,
      headers,
      credentials:
        'omit',
      cache:
        'no-store',
      redirect:
        'follow',
      signal:
        controller.signal
    };

    if (
      config.body !== undefined
    ) {
      headers.set(
        'Content-Type',
        'application/json; charset=UTF-8'
      );

      fetchOptions.body =
        JSON.stringify(
          config.body
        );
    }

    try {
      const response =
        await fetch(
          buildUrl(
            path,
            config.query
          ),
          fetchOptions
        );

      return await parseResponse(
        response
      );

    } catch (error) {
      if (
        error &&
        error.name === 'AbortError'
      ) {
        throw new VehicleAPIError(
          'ระบบใช้เวลาตอบกลับนานเกินกำหนด',
          'REQUEST_TIMEOUT',
          408
        );
      }

      if (
        error instanceof
        VehicleAPIError
      ) {
        throw error;
      }

      throw new VehicleAPIError(
        navigator.onLine
          ? 'ไม่สามารถเชื่อมต่อระบบได้'
          : 'อุปกรณ์ไม่ได้เชื่อมต่ออินเทอร์เน็ต',
        'NETWORK_ERROR',
        0,
        {
          originalMessage:
            error &&
            error.message
              ? error.message
              : String(error)
        }
      );

    } finally {
      window.clearTimeout(
        timeoutId
      );
    }
  }

  function shouldRetryRequest(
    error,
    method
  ) {
    if (method !== 'GET') {
      return false;
    }

    if (!error) {
      return false;
    }

    if (
      RETRYABLE_ERROR_CODES.has(
        error.code
      )
    ) {
      return true;
    }

    return [
      502,
      503,
      504
    ].includes(
      Number(error.status)
    );
  }

  function calculateRetryDelayMs(
    error,
    attempt
  ) {
    const retryAfterSeconds =
      Number(
        error &&
        error.details &&
        error.details.retryAfterSeconds
      );

    if (
      Number.isFinite(
        retryAfterSeconds
      ) &&
      retryAfterSeconds > 0
    ) {
      return Math.min(
        retryAfterSeconds *
          1000,
        10000
      );
    }

    return Math.min(
      700 *
        Math.pow(
          2,
          attempt
        ) +
        Math.floor(
          Math.random() *
          250
        ),
      5000
    );
  }

  function delay(
    milliseconds
  ) {
    return new Promise(
      (resolve) => {
        window.setTimeout(
          resolve,
          milliseconds
        );
      }
    );
  }

  function clampInteger(
    value,
    minimum,
    maximum,
    fallback
  ) {
    const number =
      Number(value);

    if (
      !Number.isFinite(number)
    ) {
      return fallback;
    }

    return Math.min(
      Math.max(
        Math.floor(number),
        minimum
      ),
      maximum
    );
  }

  function requireApiText(
    value,
    code,
    message
  ) {
    const text =
      String(value || '').trim();

    if (!text) {
      throw new VehicleAPIError(
        message,
        code,
        400
      );
    }

    return text;
  }

  function workflowBasePath(
    moduleId
  ) {
    const cleanModuleId =
      requireApiText(
        moduleId,
        'MODULE_ID_REQUIRED',
        'กรุณาระบุรหัส Module'
      );

    return (
      '/api/workflow/modules/' +
      encodeURIComponent(cleanModuleId)
    );
  }

  function workflowPayload(
    payload,
    defaultMethod
  ) {
    const source =
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload)
        ? { ...payload }
        : {};

    const entryCode =
      String(
        source.entryCode ||
        source.autoId ||
        source.code ||
        source.qrText ||
        source.recordId ||
        ''
      ).trim();

    const clientRequestId =
      String(
        source.clientRequestId ||
        source.requestId ||
        createRequestId()
      ).trim();

    return {
      ...source,
      entryCode,
      qrText:
        String(
          source.qrText ||
          source.rawQrText ||
          entryCode
        ).trim(),
      lookupMethod:
        String(
          source.lookupMethod ||
          source.method ||
          defaultMethod ||
          'MANUAL'
        ).trim().toUpperCase(),
      clientRequestId,
      requestId:
        String(
          source.requestId ||
          clientRequestId
        ).trim()
    };
  }

  function getClientDiagnostics() {
    let storageAvailable =
      true;

    try {
      const probeKey =
        '__alertvendor_probe__';

      window.sessionStorage
        .setItem(
          probeKey,
          '1'
        );

      window.sessionStorage
        .removeItem(
          probeKey
        );

    } catch (error) {
      storageAvailable =
        false;
    }

    return {
      status:
        navigator.onLine &&
        storageAvailable &&
        Boolean(
          getAccessToken()
        )
          ? 'PASS'
          : 'FAIL',

      checkedAt:
        new Date()
          .toISOString(),

      online:
        navigator.onLine,

      origin:
        window.location.origin,

      page:
        window.location.pathname,

      storageAvailable:
        storageAvailable,

      sessionTokenPresent:
        Boolean(
          getAccessToken()
        ),

      apiBase:
        API_BASE
    };
  }

  async function getClientProductionDiagnostics() {
    const base=getClientDiagnostics();
    const queue=await inspectInboundQueueStorage();
    return {...base,queue};
  }

  async function inspectInboundQueueStorage() {
    const fallbackKey='ALERT_VENDOR_INBOUND_PENDING_QUEUE_V2', dbName='alertvendor_inbound_pending_queue_v2', storeName='operations';
    function summarize(items,mode){const counts={pending:0,failed:0,paused:0,committed:0};(items||[]).forEach((x)=>{const s=String(x&&x.status||'').toUpperCase();if(['PENDING','SENDING','RETRY_WAIT','UNKNOWN'].includes(s))counts.pending++;else if(s==='FAILED')counts.failed++;else if(['PAUSED_AUTH','PAUSED_ACTOR'].includes(s))counts.paused++;else if(s==='COMMITTED')counts.committed++;});return {available:true,storageMode:mode,total:(items||[]).length,...counts,inspectedAt:new Date().toISOString()};}
    try {
      if (window.indexedDB) {
        const databases=typeof indexedDB.databases==='function'?await indexedDB.databases():null;
        const exists=!databases||databases.some((x)=>x&&x.name===dbName);
        if(exists){const items=await new Promise((resolve,reject)=>{const req=indexedDB.open(dbName,1);req.onerror=()=>reject(req.error||new Error('INDEXEDDB_OPEN_FAILED'));req.onsuccess=()=>{const db=req.result;if(!db.objectStoreNames.contains(storeName)){db.close();resolve([]);return;}const tx=db.transaction(storeName,'readonly'),getAll=tx.objectStore(storeName).getAll();getAll.onerror=()=>reject(getAll.error||new Error('INDEXEDDB_READ_FAILED'));getAll.onsuccess=()=>{db.close();resolve(Array.isArray(getAll.result)?getAll.result:[]);};};});return summarize(items,'INDEXED_DB');}
      }
      const raw=window.localStorage.getItem(fallbackKey),items=raw?JSON.parse(raw):[];return summarize(Array.isArray(items)?items:[],'LOCAL_STORAGE');
    } catch(error){return {available:false,storageMode:'',total:0,pending:0,failed:0,paused:0,committed:0,error:error&&error.message?error.message:String(error),inspectedAt:new Date().toISOString()};}
  }

  /************************************************************
   * Public API
   ************************************************************/

  const VehicleAPI = {
    Error:
      VehicleAPIError,

    request,

    getAccessToken,

    clearSession:
      clearAccessToken,

    getClientDiagnostics,

    getClientProductionDiagnostics,

    hasSession() {
      return Boolean(
        getAccessToken()
      );
    },

    async health() {
      const response =
        await request(
          '/api/health',
          {
            auth:
              false,

            timeoutMs:
              CONFIG.AUTH_TIMEOUT_MS
          }
        );

      return response.data;
    },

    async login(
      username,
      password
    ) {
      /*
       * ล้าง Token เก่าก่อน Login ใหม่
       */
      clearAccessToken();

      const response =
        await request(
          '/api/auth/login',
          {
            method:
              'POST',

            auth:
              false,

            timeoutMs:
              CONFIG.AUTH_TIMEOUT_MS,

            body: {
              username:
                String(
                  username || ''
                ).trim(),

              password:
                String(
                  password || ''
                )
            }
          }
        );

      const data =
        response.data || {};

      const token =
        updateTokenFromData(
          data
        );

      if (!token) {
        throw new VehicleAPIError(
          'ระบบเข้าสู่ระบบสำเร็จ แต่ไม่ได้รับ Session Token',
          'ACCESS_TOKEN_MISSING',
          502,
          null,
          response.requestId || ''
        );
      }

      return data;
    },

    async me() {
      const response =
        await request(
          '/api/auth/me',
          {
            timeoutMs:
              CONFIG.AUTH_TIMEOUT_MS
          }
        );

      return response.data;
    },

    async logout() {
      try {
        const response =
          await request(
            '/api/auth/logout',
            {
              method:
                'POST',

              timeoutMs:
                CONFIG.AUTH_TIMEOUT_MS,

              body:
                {}
            }
          );

        return response.data;

      } finally {
        /*
         * Logout ฝั่ง Client ต้องลบ Token เสมอ
         */
        clearAccessToken();
      }
    },

    async changePassword(
      currentPassword,
      newPassword
    ) {
      const response =
        await request(
          '/api/auth/change-password',
          {
            method:
              'POST',

            timeoutMs:
              CONFIG.AUTH_TIMEOUT_MS,

            body: {
              currentPassword:
                String(
                  currentPassword || ''
                ),

              newPassword:
                String(
                  newPassword || ''
                )
            }
          }
        );

      const data =
        response.data || {};

      /*
       * Worker ส่ง Token ใหม่หลังเปลี่ยนรหัสผ่าน
       */
      updateTokenFromData(
        data
      );

      return data;
    },

    async getModules() {
      const response =
        await request(
          '/api/modules'
        );

      return response.data;
    },

    async getModule(
      moduleId
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          )
        );

      return response.data;
    },

    async getRecords(
      moduleId,
      options
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/records',
          {
            query:
              options || {}
          }
        );

      return response.data;
    },

    async getOperationalBoard(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/operational-board',
          {
            query: {
              limit:
                config.limit ||
                1500,

              forceRefresh:
                config.forceRefresh === true
                  ? 'true'
                  : '',

              revisionOnly:
                config.revisionOnly === true
                  ? 'true'
                  : '',

              knownRevision:
                config.knownRevision ||
                ''
            }
          }
        );

      return response.data;
    },

    async updateShiftHandover(
      moduleId,
      action,
      payload
    ) {
      const body =
        payload &&
        typeof payload === 'object'
          ? payload
          : {};

      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/shift-handover',
          {
            method: 'POST',
            body: {
              handoverAction:
                String(
                  action || ''
                ).trim().toUpperCase(),
              snapshotKey:
                String(
                  body.snapshotKey || ''
                ).trim(),
              note:
                String(
                  body.note || ''
                ).trim()
            }
          }
        );

      return response.data;
    },

    async getMovementSummary(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/movement-summary',
          {
            query: {
              mode:
                config.mode ||
                'all',

              date:
                config.date ||
                '',

              scope:
                config.scope ||
                '',

              shift:
                config.shift ||
                config.shiftCode ||
                ''
            }
          }
        );

      return response.data;
    },



    async getShiftConfig(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/shift-config',
          {
            query: {
              date:
                config.date ||
                ''
            }
          }
        );

      return response.data;
    },


    async getMovementScope(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/movement-scope',
          {
            query: {
              scope:
                config.scope ||
                'ROLLING_4H',

              date:
                config.date ||
                '',

              shift:
                config.shift ||
                config.shiftCode ||
                ''
            }
          }
        );

      return response.data;
    },


    async getAdminShiftConfig(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/shift-config',
          {
            query: {
              date:
                config.date ||
                ''
            }
          }
        );

      return response.data;
    },


    async saveAdminShiftConfig(
      moduleId,
      payload
    ) {
      const response =
        await request(
          '/api/admin/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/shift-config',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },


    async getAdminWorkflowSlaRules(
      moduleId
    ) {
      const response =
        await request(
          '/api/admin/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/sla-rules'
        );

      return response.data;
    },


    async saveAdminWorkflowSlaRules(
      moduleId,
      payload
    ) {
      const response =
        await request(
          '/api/admin/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/sla-rules',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },


    async setupAdminWorkflowSlaRules() {
      const response =
        await request(
          '/api/admin/sla-rules/setup',
          {
            method:
              'POST',

            body: {}
          }
        );

      return response.data;
    },


    async getAdminAlertEngineStatus() {
      const response = await request('/api/admin/alert-engine/status');
      return response.data;
    },

    async setupAdminAlertEngine(options) {
      const response = await request('/api/admin/alert-engine/setup', { method: 'POST', body: options || {} });
      return response.data;
    },

    async enableAdminAlertEngine(options) {
      const response = await request('/api/admin/alert-engine/enable', { method: 'POST', body: options || {} });
      return response.data;
    },

    async disableAdminAlertEngine() {
      const response = await request('/api/admin/alert-engine/disable', { method: 'POST', body: {} });
      return response.data;
    },

    async runAdminAlertEngine(options) {
      const response = await request('/api/admin/alert-engine/run', { method: 'POST', timeoutMs: 120000, body: options || {} });
      return response.data;
    },

    async getAdminAlertDeliveries(options) {
      const config = options && typeof options === 'object' ? options : {};
      const response = await request('/api/admin/alert-engine/deliveries', { query: { limit: clampInteger(config.limit, 1, 500, 100), moduleId: config.moduleId || '' } });
      return response.data;
    },

    async setupAdminShiftSystem() {
      const response =
        await request(
          '/api/admin/shifts/setup',
          {
            method:
              'POST',

            body: {}
          }
        );

      return response.data;
    },


    async runAdminShiftSnapshots(
      options
    ) {
      const response =
        await request(
          '/api/admin/shifts/run-snapshots',
          {
            method:
              'POST',

            body:
              options || {}
          }
        );

      return response.data;
    },


    async getAdminShiftStatistics(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/shifts/statistics',
          {
            query: {
              moduleId:
                config.moduleId ||
                '',

              startDate:
                config.startDate ||
                '',

              endDate:
                config.endDate ||
                '',

              shift:
                config.shift ||
                '',

              limit:
                config.limit ||
                100
            }
          }
        );

      return response.data;
    },


    async getReceivingFlow(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(moduleId) +
          '/receiving-flow',
          {
            query: {
              mode: config.mode || 'ACTIVE'
            }
          }
        );

      return response.data;
    },
    async completeReceiving(
      moduleId,
      record
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/receiving-complete',
          {
            method:
              'POST',

            timeoutMs:
              Math.min(
                Number(CONFIG.SAVE_TIMEOUT_MS || 60000),
                45000
              ),

            requestId:
              String(record && (record.clientRequestId || record.requestId) || ''),

            body:
              record ||
              {}
          }
        );

      return response.data;
    },


    async getReceivingCommitStatus(
      moduleId,
      record
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/receiving-status',
          {
            method:
              'POST',

            timeoutMs:
              Math.min(
                Number(
                  CONFIG.API_TIMEOUT_MS ||
                  30000
                ),
                30000
              ),

            requestId:
              String(record && (record.clientRequestId || record.requestId) || ''),

            body:
              record ||
              {}
          }
        );

      return response.data;
    },


    async syncReceivingWorkflow(
      moduleId,
      record
    ) {
      const response = await request(
        '/api/modules/' +
        encodeURIComponent(moduleId) +
        '/receiving-workflow-sync',
        {
          method: 'POST',
          timeoutMs: Math.min(
            Number(CONFIG.SAVE_TIMEOUT_MS || 60000),
            45000
          ),
          requestId: String(
            record && (record.clientRequestId || record.requestId) || ''
          ),
          body: record || {}
        }
      );

      return response.data;
    },


    /**********************************************************
     * Inbound Workflow API
     **********************************************************/

    async lookupInboundWorkflow(
      moduleId,
      entryCode,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const cleanEntryCode =
        requireApiText(
          entryCode ||
          config.entryCode ||
          config.autoId ||
          config.code,
          'ENTRY_CODE_REQUIRED',
          'กรุณาระบุ Auto ID หรือรหัสเข้าพื้นที่'
        );

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/lookup',
          {
            dedupe: false,
            query: {
              entryCode:
                cleanEntryCode,
              method:
                config.lookupMethod ||
                config.method ||
                'MANUAL',
              _:
                config.cacheBust ||
                ''
            }
          }
        );

      return response.data;
    },

    async getInboundWorkflowState(
      moduleId,
      entryCode,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const cleanEntryCode =
        requireApiText(
          entryCode ||
          config.entryCode ||
          config.autoId ||
          config.code,
          'ENTRY_CODE_REQUIRED',
          'กรุณาระบุ Auto ID หรือรหัสเข้าพื้นที่'
        );

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/state/' +
          encodeURIComponent(cleanEntryCode),
          {
            dedupe: false,
            query: {
              method:
                config.lookupMethod ||
                config.method ||
                'MANUAL',
              _:
                config.cacheBust ||
                ''
            }
          }
        );

      return response.data;
    },

    async submitInboundDocument(
      moduleId,
      payload
    ) {
      const body =
        workflowPayload(
          payload,
          'SCAN'
        );

      requireApiText(
        body.entryCode,
        'ENTRY_CODE_REQUIRED',
        'กรุณาระบุ Auto ID ก่อนบันทึกยื่นเอกสาร'
      );

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/submit-document',
          {
            method: 'POST',
            timeoutMs:
              CONFIG.SAVE_TIMEOUT_MS ||
              90000,
            requestId:
              body.clientRequestId,
            body
          }
        );

      return response.data;
    },

    async completeInboundWorkflowReceiving(
      moduleId,
      payload
    ) {
      const body =
        workflowPayload(
          payload,
          'MANUAL'
        );

      requireApiText(
        body.entryCode,
        'ENTRY_CODE_REQUIRED',
        'ไม่พบ Auto ID สำหรับ Sync สถานะตรวจรับเสร็จ'
      );

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/complete-receiving',
          {
            method: 'POST',
            timeoutMs:
              CONFIG.SAVE_TIMEOUT_MS ||
              90000,
            requestId:
              body.clientRequestId,
            body
          }
        );

      return response.data;
    },

    async returnInboundDocument(
      moduleId,
      payload
    ) {
      const body =
        workflowPayload(
          payload,
          'SCAN'
        );

      requireApiText(
        body.entryCode,
        'ENTRY_CODE_REQUIRED',
        'กรุณาระบุ Auto ID ก่อนบันทึกรับเอกสารคืน'
      );

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/return-document',
          {
            method: 'POST',
            timeoutMs:
              CONFIG.SAVE_TIMEOUT_MS ||
              90000,
            requestId:
              body.clientRequestId,
            body
          }
        );

      return response.data;
    },

    async cancelInboundWorkflow(
      moduleId,
      payload
    ) {
      const source =
        workflowPayload(
          payload,
          'MANUAL'
        );

      const body = {
        ...source,
        reason:
          String(
            source.reason ||
            source.cancelReason ||
            source.note ||
            ''
          ).trim(),
        stageCode:
          String(
            source.stageCode ||
            source.statusCode ||
            ''
          ).trim()
      };

      if (!body.entryCode && !body.eventId) {
        throw new VehicleAPIError(
          'กรุณาระบุ Auto ID หรือรหัสเหตุการณ์ที่ต้องการยกเลิก',
          'ENTRY_CODE_OR_EVENT_ID_REQUIRED',
          400
        );
      }

      requireApiText(
        body.reason,
        'CANCEL_REASON_REQUIRED',
        'กรุณาระบุเหตุผลการยกเลิก'
      );

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/cancel-event',
          {
            method: 'POST',
            timeoutMs:
              CONFIG.SAVE_TIMEOUT_MS ||
              90000,
            requestId:
              body.clientRequestId,
            body
          }
        );

      return response.data;
    },

    async getInboundWorkflowDashboard(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/dashboard',
          {
            dedupe:
              !config.cacheBust,
            query: {
              limit:
                clampInteger(
                  config.limit,
                  1,
                  1000,
                  500
                ),
              revisionOnly:
                config.revisionOnly === true
                  ? 'true'
                  : '',
              knownRevision:
                config.knownRevision ||
                '',
              _:
                config.cacheBust ||
                ''
            }
          }
        );

      return response.data;
    },

    async getInboundWorkflowSlaAlerts(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/sla-alerts',
          {
            query: {
              limit:
                clampInteger(
                  config.limit,
                  1,
                  200,
                  50
                ),
              sinceEpochMs:
                Math.max(0, Number(config.sinceEpochMs) || 0),
              evaluate:
                config.evaluate === false
                  ? 'false'
                  : 'true'
            }
          }
        );

      return response.data;
    },

    async setupInboundWorkflowDefaultSlaRules(
      moduleId
    ) {
      const response =
        await request(
          workflowBasePath(moduleId) +
          '/sla-alerts/setup-default',
          {
            method: 'POST',
            body: {}
          }
        );

      return response.data;
    },

    async getInboundWorkflowReport(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/report',
          {
            query: {
              date:
                config.date ||
                config.reportDate ||
                '',
              limit:
                clampInteger(
                  config.limit,
                  1,
                  5000,
                  500
                )
            }
          }
        );

      return response.data;
    },

    async getInboundWorkflowAudit(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/audit',
          {
            query: {
              date:
                config.date ||
                config.reportDate ||
                '',
              limit:
                clampInteger(
                  config.limit,
                  1,
                  1000,
                  300
                )
            }
          }
        );

      return response.data;
    },

    async exportInboundWorkflowCsv(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/export/csv',
          {
            method: 'POST',
            timeoutMs: 120000,
            body: {
              date: config.date || config.reportDate || '',
              status: config.status || config.statusCode || '',
              query: config.query || config.search || '',
              limit: clampInteger(config.limit, 1, 5000, 500)
            }
          }
        );

      return response.data;
    },

    async syncInboundWorkflowGateOut(
      moduleId,
      payload
    ) {
      const body =
        workflowPayload(
          payload,
          'MANUAL'
        );

      requireApiText(
        body.entryCode,
        'ENTRY_CODE_REQUIRED',
        'กรุณาระบุ Auto ID สำหรับ Sync Gate Out'
      );

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/sync-gate-out',
          {
            method: 'POST',
            body
          }
        );

      return response.data;
    },

    async previewInboundGateOutSync(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/gate-out-sync/preview',
          {
            query: {
              limit:
                clampInteger(
                  config.limit,
                  1,
                  100,
                  30
                )
            }
          }
        );

      return response.data;
    },

    async runInboundGateOutSync(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/gate-out-sync/run',
          {
            method: 'POST',
            timeoutMs: 120000,
            body: {
              limit:
                clampInteger(
                  config.limit,
                  1,
                  100,
                  30
                )
            }
          }
        );

      return response.data;
    },

    async getInboundAutoGateOutStatus(
      moduleId
    ) {
      const response =
        await request(
          workflowBasePath(moduleId) +
          '/gate-out-sync/auto/status'
        );

      return response.data;
    },

    async enableInboundAutoGateOut(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/gate-out-sync/auto/enable',
          {
            method: 'POST',
            body: {
              limit:
                clampInteger(
                  config.limit,
                  1,
                  100,
                  30
                ),
              intervalMinutes:
                Number(
                  config.intervalMinutes
                ) || 10
            }
          }
        );

      return response.data;
    },

    async disableInboundAutoGateOut(
      moduleId
    ) {
      const response =
        await request(
          workflowBasePath(moduleId) +
          '/gate-out-sync/auto/disable',
          {
            method: 'POST',
            body: {}
          }
        );

      return response.data;
    },

    async runInboundAutoGateOutNow(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          workflowBasePath(moduleId) +
          '/gate-out-sync/auto/run-now',
          {
            method: 'POST',
            timeoutMs: 120000,
            body: {
              limit:
                clampInteger(
                  config.limit,
                  1,
                  100,
                  30
                )
            }
          }
        );

      return response.data;
    },


    async getCalendar(
      moduleId,
      month,
      year
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/calendar',
          {
            query: {
              month,
              year
            }
          }
        );

      return response.data;
    },

    async getDailySummary(
      moduleId,
      date
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/daily-summary',
          {
            query: {
              date
            }
          }
        );

      return response.data;
    },

    async previewCheckout(
      moduleId,
      record
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/checkout/preview',
          {
            method:
              'POST',

            body:
              record
          }
        );

      return response.data;
    },

    async checkout(
      moduleId,
      record
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/checkout',
          {
            method:
              'POST',

            body:
              record
          }
        );

      return response.data;
    },

    async getAdminDashboard(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/dashboard',
          {
            query: {
              auditLimit:
                config.auditLimit || 30
            }
          }
        );

      return response.data;
    },

    async getAdminUiSchema() {
      const response =
        await request(
          '/api/admin/ui-schema'
        );

      return response.data;
    },

    async getAdminNewModuleTemplate() {
      const response =
        await request(
          '/api/admin/modules/new-template'
        );

      return response.data;
    },

    async getAdminModuleBundle(
      moduleId
    ) {
      const response =
        await request(
          '/api/admin/modules/' +
          encodeURIComponent(
            moduleId
          )
        );

      return response.data;
    },

    async inspectAdminSource(
      payload
    ) {
      const response =
        await request(
          '/api/admin/source-metadata',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },

    async saveAdminModuleBundle(
      payload
    ) {
      const response =
        await request(
          '/api/admin/modules/save',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },

    async duplicateAdminModule(
      payload
    ) {
      const response =
        await request(
          '/api/admin/modules/duplicate',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },

    async archiveAdminModule(
      moduleId
    ) {
      const response =
        await request(
          '/api/admin/modules/archive',
          {
            method:
              'POST',

            body: {
              moduleId
            }
          }
        );

      return response.data;
    },

    async getAdminUsers() {
      const response =
        await request(
          '/api/admin/users'
        );

      return response.data;
    },

    async saveAdminUser(
      payload
    ) {
      const response =
        await request(
          '/api/admin/users/save',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },

    async resetAdminUserPassword(
      payload
    ) {
      const response =
        await request(
          '/api/admin/users/reset-password',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },

    async unlockAdminUser(
      userId
    ) {
      const response =
        await request(
          '/api/admin/users/unlock',
          {
            method:
              'POST',

            body: {
              userId
            }
          }
        );

      return response.data;
    },

    async saveAdminSettings(
      settings
    ) {
      const response =
        await request(
          '/api/admin/settings',
          {
            method:
              'POST',

            body: {
              settings:
                settings || {}
            }
          }
        );

      return response.data;
    },

    async getAdminAudit(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/audit',
          {
            query: {
              limit:
                config.limit || 50,

              username:
                config.username || '',

              moduleId:
                config.moduleId || '',

              action:
                config.action || ''
            }
          }
        );

      return response.data;
    },


    async getAdminAutoCloseStatus() {
      const response =
        await request(
          '/api/admin/auto-close/status'
        );

      return response.data;
    },

    async previewAdminAutoClose(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/auto-close/preview',
          {
            method:
              'POST',

            timeoutMs:
              120000,

            body: {
              moduleId:
                config.moduleId || '',

              maxClose:
                config.maxClose || 200
            }
          }
        );

      return response.data;
    },

    async runAdminAutoClose(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/auto-close/run',
          {
            method:
              'POST',

            timeoutMs:
              180000,

            body: {
              moduleId:
                config.moduleId || '',

              maxClose:
                config.maxClose || 200
            }
          }
        );

      return response.data;
    },

    async getAdminAutoCloseHistory(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/auto-close/history',
          {
            query: {
              limit:
                config.limit || 50,

              moduleId:
                config.moduleId || '',

              result:
                config.result || '',

              requestId:
                config.requestId || ''
            }
          }
        );

      return response.data;
    },


    async getAdminWorkflowSyncStatus(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/workflow-sync/status',
          {
            query: {
              moduleId:
                config.moduleId || '',

              limit:
                config.limit || 300,

              forceRefresh:
                config.forceRefresh === true
                  ? 'true'
                  : ''
            },

            timeoutMs:
              120000
          }
        );

      return response.data;
    },


    async previewAdminWorkflowSync(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/workflow-sync/preview',
          {
            method:
              'POST',

            timeoutMs:
              120000,

            body: {
              moduleId:
                config.moduleId || '',

              limit:
                config.limit || 300,

              eventIds:
                Array.isArray(config.eventIds)
                  ? config.eventIds
                  : [],

              includeSynced:
                config.includeSynced === true,

              includeBlocked:
                config.includeBlocked !== false,

              includeErrors:
                config.includeErrors !== false
            }
          }
        );

      return response.data;
    },


    async repairAdminWorkflowSync(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/workflow-sync/repair',
          {
            method:
              'POST',

            timeoutMs:
              240000,

            body: {
              moduleId:
                config.moduleId || '',

              eventIds:
                Array.isArray(config.eventIds)
                  ? config.eventIds
                  : [],

              maxRepair:
                config.maxRepair || 20,

              scanLimit:
                config.scanLimit || 300
            }
          }
        );

      return response.data;
    },


    async getAdminWorkflowSyncHistory(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/workflow-sync/history',
          {
            query: {
              moduleId:
                config.moduleId || '',

              result:
                config.result || '',

              limit:
                config.limit || 50
            },

            timeoutMs:
              120000
          }
        );

      return response.data;
    },


    async getManagementReportingConfig(moduleId) {
      const response = await request('/api/admin/management-report/config/' + encodeURIComponent(moduleId));
      return response.data;
    },

    async createManagementReportPackage(moduleId, options) {
      const response = await request('/api/admin/management-report/create/' + encodeURIComponent(moduleId), {
        method: 'POST', timeoutMs: 240000, body: options || {}
      });
      return response.data;
    },

    async createAllWorkflowStagesExport(moduleId, options) {
      const response = await request('/api/admin/management-report/all-stages/' + encodeURIComponent(moduleId), {
        method: 'POST', timeoutMs: 300000, body: options || {}
      });
      return response.data;
    },

    async getManagementReportJobStatus(jobId) {
      const response = await request(
        '/api/admin/management-report/job/' + encodeURIComponent(jobId),
        { timeoutMs: 60000 }
      );
      return response.data;
    },

    async getManagementReportDownloadMeta(
      exportId
    ) {
      const response =
        await request(
          '/api/admin/management-report/download/' +
          encodeURIComponent(
            exportId
          ) +
          '/meta',
          {
            timeoutMs:
              60000
          }
        );

      return response.data;
    },


    async getManagementReportDownloadChunk(
      exportId,
      offset,
      size
    ) {
      const response =
        await request(
          '/api/admin/management-report/download/' +
          encodeURIComponent(
            exportId
          ) +
          '/chunk',
          {
            query: {
              offset:
                Number(
                  offset ||
                  0
                ),

              size:
                Number(
                  size ||
                  524288
                )
            },

            timeoutMs:
              90000
          }
        );

      return response.data;
    },


    async downloadManagementReportFile(
      exportId,
      options
    ) {
      const config =
        options &&
        typeof options ===
          'object'
          ? options
          : {};

      const meta =
        await this
          .getManagementReportDownloadMeta(
            exportId
          );

      const chunkSize =
        Number(
          meta.chunkSize ||
          524288
        );

      const sizeBytes =
        Number(
          meta.sizeBytes ||
          0
        );

      const chunks = [];
      let offset =
        0;

      while (
        offset <
        sizeBytes
      ) {
        const data =
          await this
            .getManagementReportDownloadChunk(
              exportId,
              offset,
              chunkSize
            );

        const binary =
          window.atob(
            String(
              data.base64 ||
              ''
            )
          );

        const bytes =
          new Uint8Array(
            binary.length
          );

        for (
          let index = 0;
          index <
            binary.length;
          index += 1
        ) {
          bytes[index] =
            binary.charCodeAt(
              index
            );
        }

        chunks.push(
          bytes
        );

        const nextOffset =
          Number(
            data.nextOffset
          );

        if (
          !Number.isFinite(
            nextOffset
          ) ||
          nextOffset <=
            offset
        ) {
          throw new VehicleAPIError(
            'ระบบดาวน์โหลดส่งตำแหน่งไฟล์ไม่ถูกต้อง',
            'DOWNLOAD_PROGRESS_INVALID',
            0,
            {
              offset:
                offset,
              nextOffset:
                nextOffset
            }
          );
        }

        offset =
          nextOffset;

        if (
          typeof config.onProgress ===
            'function'
        ) {
          config.onProgress({
            loadedBytes:
              offset,

            totalBytes:
              sizeBytes,

            percent:
              sizeBytes > 0
                ? Math.min(
                    100,
                    Math.round(
                      (
                        offset /
                        sizeBytes
                      ) *
                      100
                    )
                  )
                : 100
          });
        }
      }

      const blob =
        new Blob(
          chunks,
          {
            type:
              meta.mimeType ||
              'application/octet-stream'
          }
        );

      const url =
        URL.createObjectURL(
          blob
        );

      const anchor =
        document.createElement(
          'a'
        );

      anchor.href =
        url;

      anchor.download =
        meta.filename ||
        'AlertVendor-Export';

      document.body.appendChild(
        anchor
      );

      anchor.click();
      anchor.remove();

      window.setTimeout(
        () =>
          URL.revokeObjectURL(
            url
          ),
        5000
      );

      return {
        ...meta,
        downloaded:
          true
      };
    },


    async listManagementReportExports(moduleId, options) {
      const config = options && typeof options === 'object' ? options : {};
      const response = await request('/api/admin/management-report/exports/' + encodeURIComponent(moduleId), {
        query: { limit: clampInteger(config.limit, 1, 100, 20) }, timeoutMs: 120000
      });
      return response.data;
    },

    async cleanupManagementReportFiles() {
      const response = await request('/api/admin/management-report/cleanup', { method: 'POST', body: {}, timeoutMs: 120000 });
      return response.data;
    },

    async runProductionAcceptance(options) {
      const response=await request('/api/admin/diagnostics/acceptance',{method:'POST',timeoutMs:180000,body:{options:options||{}}});return response.data;
    },

    async runProductionConcurrencyProbe(payload) {
      const response=await request('/api/admin/diagnostics/concurrency',{method:'POST',timeoutMs:60000,body:payload||{}});return response.data;
    },

    async finalizeProductionConcurrencyProbe(probeId) {
      const response=await request('/api/admin/diagnostics/concurrency/finalize',{method:'POST',timeoutMs:60000,body:{probeId:String(probeId||'').trim()}});return response.data;
    },

    async runProductionDiagnostics(
      options
    ) {
      const response =
        await request(
          '/api/admin/diagnostics',
          {
            method:
              'POST',

            timeoutMs:
              120000,

            body: {
              options:
                options || {}
            }
          }
        );

      return response.data;
    },

    async validateAdminSystem() {
      const response =
        await request(
          '/api/admin/validate',
          {
            method:
              'POST',

            body:
              {}
          }
        );

      return response.data;
    }
  };

  window.VehicleAPI =
    VehicleAPI;

})(window);
