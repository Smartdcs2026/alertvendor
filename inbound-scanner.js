/************************************************************
 * inbound-scanner.js
 * ROUND 05 HOTFIX 05 — Camera standby scanner engine
 * Native BarcodeDetector + ZXing fallback
 ************************************************************/
(function (window) {
  'use strict';

  class InboundScanner {
    constructor(options) {
      const config = options && typeof options === 'object' ? options : {};
      this.video = config.video || null;
      this.onScan = typeof config.onScan === 'function' ? config.onScan : function () {};
      this.onStatus = typeof config.onStatus === 'function' ? config.onStatus : function () {};
      this.onError = typeof config.onError === 'function' ? config.onError : function () {};
      this.scanIntervalMs = Number(config.scanIntervalMs) || 90;
      this.pauseAfterScanMs = Number(config.pauseAfterScanMs) || 900;
      this.sameCodeBlockMs = Number(config.sameCodeBlockMs) || 15000;
      this.stream = null;
      this.detector = null;
      this.zxingReader = null;
      this.engine = '';
      this.running = false;
      this.pausedUntil = 0;
      this.lastText = '';
      this.lastTextAt = 0;
      this.loopTimer = 0;
    }

    async start() {
      if (this.running) {
        return {started: true, reused: true, engine: this.engine};
      }
      if (!this.video) {
        throw scannerError('SCANNER_VIDEO_MISSING', 'ไม่พบพื้นที่แสดงภาพกล้อง');
      }
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        throw scannerError('CAMERA_NOT_SUPPORTED', 'เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง ให้ใช้ช่องกรอกรหัสหรือเครื่องสแกนแทน');
      }

      if (typeof window.BarcodeDetector === 'function') {
        try {
          return await this.startNative_();
        } catch (error) {
          console.warn('Native scanner failed; fallback to ZXing', error);
          this.stop();
        }
      }

      if (window.ZXing && typeof window.ZXing.BrowserMultiFormatReader === 'function') {
        return await this.startZxing_();
      }

      throw scannerError('SCANNER_ENGINE_NOT_AVAILABLE', 'เครื่องนี้ไม่มีตัวอ่าน QR อัตโนมัติ ให้ใช้เครื่องสแกนหรือกรอกรหัสเอง');
    }

    async startNative_() {
      try {
        this.detector = new window.BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'itf']
        });
      } catch (error) {
        throw scannerError('BARCODE_DETECTOR_NOT_READY', 'BarcodeDetector ไม่พร้อมใช้งาน');
      }

      this.stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', 'playsinline');
      this.video.muted = true;
      await this.video.play();

      this.engine = 'BARCODE_DETECTOR';
      this.running = true;
      this.onStatus('READY', 'กล้องพร้อมสแกน');
      this.scheduleLoop_(80);
      return {started: true, reused: false, engine: this.engine};
    }

    async startZxing_() {
      this.engine = 'ZXING';
      this.running = true;
      this.zxingReader = new window.ZXing.BrowserMultiFormatReader();
      this.onStatus('READY', 'กล้องพร้อมสแกน');

      await this.zxingReader.decodeFromConstraints(
        cameraConstraints(),
        this.video,
        (result) => {
          if (!this.running || Date.now() < this.pausedUntil) return;
          if (!result) return;
          const text = String(typeof result.getText === 'function' ? result.getText() : result.text || '').trim();
          if (text) this.handleText_(text, 'CAMERA_ZXING');
        }
      );

      return {started: true, reused: false, engine: this.engine};
    }

    scheduleLoop_(delay) {
      window.clearTimeout(this.loopTimer);
      this.loopTimer = window.setTimeout(() => this.nativeLoop_(), Number(delay) || this.scanIntervalMs);
    }

    async nativeLoop_() {
      if (!this.running || !this.detector || !this.video) return;
      try {
        if (Date.now() >= this.pausedUntil && this.video.readyState >= 2) {
          const codes = await this.detector.detect(this.video);
          if (Array.isArray(codes) && codes.length > 0) {
            const rawValue = String(codes[0].rawValue || '').trim();
            if (rawValue) this.handleText_(rawValue, 'CAMERA_NATIVE');
          }
        }
      } catch (error) {
        // keep loop alive; transient camera decode errors are normal
      } finally {
        if (this.running) this.scheduleLoop_(this.scanIntervalMs);
      }
    }

    handleText_(text, source) {
      const cleanText = normalizeScanText(text);
      if (!cleanText) return;
      const now = Date.now();
      if (cleanText === this.lastText && now - this.lastTextAt < this.sameCodeBlockMs) {
        this.onStatus('DUPLICATE', 'กันสแกนซ้ำ ' + cleanText);
        return;
      }
      this.lastText = cleanText;
      this.lastTextAt = now;
      this.pause(this.pauseAfterScanMs);
      this.onScan(cleanText, {source: source || 'CAMERA', rawText: text, engine: this.engine});
    }

    pause(ms) {
      this.pausedUntil = Math.max(this.pausedUntil, Date.now() + (Number(ms) || this.pauseAfterScanMs));
    }

    blockText(text, ms) {
      this.lastText = normalizeScanText(text);
      this.lastTextAt = Date.now() - Math.max(0, this.sameCodeBlockMs - (Number(ms) || this.sameCodeBlockMs));
      this.pausedUntil = Math.max(this.pausedUntil, Date.now() + 250);
    }

    stop() {
      this.running = false;
      window.clearTimeout(this.loopTimer);
      this.loopTimer = 0;

      if (this.zxingReader && typeof this.zxingReader.reset === 'function') {
        try { this.zxingReader.reset(); } catch (error) {}
      }
      this.zxingReader = null;

      if (this.stream) {
        this.stream.getTracks().forEach((track) => {
          try { track.stop(); } catch (error) {}
        });
      }
      this.stream = null;
      if (this.video) {
        try { this.video.pause(); } catch (error) {}
        this.video.srcObject = null;
      }
      this.onStatus('STOPPED', 'ปิดกล้องแล้ว');
    }
  }

  function cameraConstraints() {
    return {
      video: {
        facingMode: {ideal: 'environment'},
        width: {ideal: 1280},
        height: {ideal: 720},
        frameRate: {ideal: 30, max: 60}
      },
      audio: false
    };
  }

  function normalizeScanText(value) {
    return String(value || '')
      .trim()
      .replace(/^https?:\/\/[^?]+\?/i, '')
      .replace(/^.*(?:autoId|entryCode|code)=/i, '')
      .split(/[&#\s]/)[0]
      .trim()
      .toUpperCase();
  }

  function scannerError(code, message) {
    const error = new Error(message || 'เปิดระบบสแกนไม่ได้');
    error.code = code || 'SCANNER_ERROR';
    return error;
  }

  window.InboundScanner = InboundScanner;
})(window);
