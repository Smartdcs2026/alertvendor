/************************************************************
 * inbound-scanner.js
 * ROUND 05 HOTFIX 01 — Native BarcodeDetector + ZXing Fallback
 *
 * แก้ปัญหา:
 * - บางเครื่อง/Chrome Desktop ไม่มี BarcodeDetector
 * - ให้ fallback ไปใช้ ZXing ถ้าโหลด library ได้
 * - ถ้าไม่มีทั้งสองวิธี ให้ใช้ช่องกรอกรหัสเองโดยไม่ทำให้หน้าเสีย
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
      this.scanIntervalMs = Number(config.scanIntervalMs) || 180;
      this.cooldownMs = Number(config.cooldownMs) || 1600;
      this.stream = null;
      this.detector = null;
      this.zxingReader = null;
      this.engine = '';
      this.running = false;
      this.pausedUntil = 0;
      this.lastScanText = '';
      this.lastScanAt = 0;
      this.loopTimer = 0;
    }

    isSupported() {
      return (
        Boolean(this.video) &&
        Boolean(navigator.mediaDevices) &&
        typeof navigator.mediaDevices.getUserMedia === 'function' &&
        (
          typeof window.BarcodeDetector === 'function' ||
          this.hasZxingSupport()
        )
      );
    }

    hasZxingSupport() {
      return Boolean(
        window.ZXing &&
        typeof window.ZXing.BrowserMultiFormatReader === 'function'
      );
    }

    async start() {
      if (this.running) {
        return {
          started: true,
          reused: true,
          engine: this.engine || 'REUSED'
        };
      }

      if (!this.video) {
        throw createScannerError(
          'SCANNER_VIDEO_MISSING',
          'ไม่พบพื้นที่แสดงกล้อง'
        );
      }

      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        throw createScannerError(
          'CAMERA_NOT_SUPPORTED',
          'เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง กรุณากรอกรหัสเอง'
        );
      }

      if (typeof window.BarcodeDetector === 'function') {
        try {
          return await this.startNativeDetector_();
        } catch (error) {
          console.warn('Native BarcodeDetector ใช้งานไม่ได้ จะลอง ZXing แทน', error);
          this.stop();
        }
      }

      if (this.hasZxingSupport()) {
        try {
          return await this.startZxingDetector_();
        } catch (error) {
          console.warn('ZXing ใช้งานไม่ได้', error);
          this.stop();
          throw createScannerError(
            'ZXING_CAMERA_FAILED',
            'เปิดกล้องสำหรับสแกนไม่ได้ กรุณาอนุญาตกล้องหรือกรอกรหัสเอง'
          );
        }
      }

      throw createScannerError(
        'SCANNER_ENGINE_NOT_AVAILABLE',
        'เครื่องนี้ไม่รองรับตัวอ่าน QR อัตโนมัติ กรุณากรอกรหัสเอง'
      );
    }

    async startNativeDetector_() {
      try {
        this.detector = await createNativeDetector();
      } catch (error) {
        throw createScannerError(
          'BARCODE_DETECTOR_NOT_SUPPORTED',
          'เครื่องนี้ไม่รองรับ BarcodeDetector'
        );
      }

      try {
        this.stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
      } catch (error) {
        throw createScannerError(
          'CAMERA_OPEN_FAILED',
          'เปิดกล้องไม่ได้ กรุณาอนุญาตกล้องหรือกรอกรหัสเอง'
        );
      }

      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', 'playsinline');
      this.video.muted = true;

      try {
        await this.video.play();
      } catch (error) {
        this.stop();
        throw createScannerError(
          'CAMERA_PLAY_FAILED',
          'เริ่มแสดงภาพจากกล้องไม่ได้ กรุณาลองใหม่หรือกรอกรหัสเอง'
        );
      }

      this.engine = 'BARCODE_DETECTOR';
      this.running = true;
      this.onStatus('CAMERA_READY', 'กล้องพร้อมสแกน');
      this.scheduleLoop(100);

      return {
        started: true,
        reused: false,
        engine: this.engine
      };
    }

    async startZxingDetector_() {
      this.zxingReader = new window.ZXing.BrowserMultiFormatReader();
      this.engine = 'ZXING';
      this.running = true;
      this.onStatus('CAMERA_READY', 'กล้องพร้อมสแกน');

      const constraints = cameraConstraints();

      await this.zxingReader.decodeFromConstraints(
        constraints,
        this.video,
        (result, error) => {
          if (!this.running) {
            return;
          }

          if (Date.now() < this.pausedUntil) {
            return;
          }

          if (result) {
            const rawText = String(
              typeof result.getText === 'function'
                ? result.getText()
                : result.text || ''
            ).trim();

            if (rawText) {
              this.handleDetectedText_(rawText, result);
            }
          }
        }
      );

      return {
        started: true,
        reused: false,
        engine: this.engine
      };
    }

    stop() {
      this.running = false;

      if (this.loopTimer) {
        window.clearTimeout(this.loopTimer);
        this.loopTimer = 0;
      }

      if (this.zxingReader) {
        try {
          this.zxingReader.reset();
        } catch (error) {
          // no-op
        }
      }

      this.zxingReader = null;

      if (this.video) {
        try {
          this.video.pause();
          this.video.srcObject = null;
        } catch (error) {
          // no-op
        }
      }

      if (this.stream) {
        this.stream.getTracks().forEach(function (track) {
          try {
            track.stop();
          } catch (error) {
            // no-op
          }
        });
      }

      this.stream = null;
      this.detector = null;
      this.engine = '';
      this.onStatus('CAMERA_STOPPED', 'ปิดกล้องแล้ว');
    }

    pause(milliseconds) {
      this.pausedUntil = Date.now() + (Number(milliseconds) || this.cooldownMs);
    }

    resume() {
      this.pausedUntil = 0;
    }

    scheduleLoop(delay) {
      if (!this.running || this.engine !== 'BARCODE_DETECTOR') {
        return;
      }

      if (this.loopTimer) {
        window.clearTimeout(this.loopTimer);
      }

      this.loopTimer = window.setTimeout(
        () => this.detectLoop(),
        Number(delay) || this.scanIntervalMs
      );
    }

    async detectLoop() {
      if (!this.running || this.engine !== 'BARCODE_DETECTOR') {
        return;
      }

      if (Date.now() < this.pausedUntil) {
        this.scheduleLoop(this.scanIntervalMs);
        return;
      }

      if (!this.detector || !this.video || this.video.readyState < 2) {
        this.scheduleLoop(this.scanIntervalMs);
        return;
      }

      try {
        const results = await this.detector.detect(this.video);
        const first = Array.isArray(results) && results.length > 0 ? results[0] : null;
        const rawText = first && first.rawValue ? String(first.rawValue).trim() : '';

        if (rawText) {
          this.handleDetectedText_(rawText, first);
        }
      } catch (error) {
        this.onError(error);
      }

      this.scheduleLoop(this.scanIntervalMs);
    }

    handleDetectedText_(rawText, source) {
      const now = Date.now();

      if (
        rawText !== this.lastScanText ||
        now - this.lastScanAt > this.cooldownMs
      ) {
        this.lastScanText = rawText;
        this.lastScanAt = now;
        this.pause(this.cooldownMs);
        this.onScan(rawText, source);
      }
    }
  }

  async function createNativeDetector() {
    if (typeof window.BarcodeDetector !== 'function') {
      throw new Error('BarcodeDetector unavailable');
    }

    const requestedFormats = [
      'qr_code',
      'code_128',
      'code_39',
      'code_93',
      'ean_13',
      'ean_8',
      'upc_a',
      'upc_e',
      'itf'
    ];

    if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = requestedFormats.filter(function (format) {
        return supported.includes(format);
      });

      return new window.BarcodeDetector(
        formats.length > 0
          ? {formats: formats}
          : undefined
      );
    }

    return new window.BarcodeDetector({formats: requestedFormats});
  }

  function cameraConstraints() {
    return {
      audio: false,
      video: {
        facingMode: {
          ideal: 'environment'
        },
        width: {
          ideal: 1280
        },
        height: {
          ideal: 720
        },
        frameRate: {
          ideal: 30,
          max: 60
        }
      }
    };
  }

  function createScannerError(code, message) {
    const error = new Error(message || 'สแกนเนอร์ไม่พร้อมใช้งาน');
    error.code = code || 'SCANNER_ERROR';
    return error;
  }

  window.InboundScanner = InboundScanner;
})(window);
