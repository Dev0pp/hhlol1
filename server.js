// ===== server.js (استبدل الملف كله بهذا) =====
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');

const app = express();

// أمن بسماح للـ CDN (Tailwind, Fonts, ... )
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({ origin: [process.env.PUBLIC_SITE_ORIGIN].filter(Boolean) }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true })); // يدعم form/FormData
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 600 }));

// ===== التخزين =====
const STORAGE_DIR = process.env.STORAGE_DIR || 'data/edocs';
const RECORDS_PATH = path.join(STORAGE_DIR, 'records.json');
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
if (!fs.existsSync(RECORDS_PATH)) fs.writeFileSync(RECORDS_PATH, '[]', 'utf8');

// اجلب/احفظ السجلات
function loadRecords() {
  try { return JSON.parse(fs.readFileSync(RECORDS_PATH, 'utf8')); } catch { return []; }
}
function saveRecords(recs) {
  const tmp = RECORDS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(recs, null, 2), 'utf8');
  fs.renameSync(tmp, RECORDS_PATH);
}

// تطبيع الإدخالات (يحذف غير الأرقام + يحول أرقام عربية لإنجليزية)
const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
const normalize = (s = '') => {
  s = String(s).replace(/[٠-٩]/g, d => arabicDigits.indexOf(d));
  s = s.replace(/\D+/g, '');
  return s.trim();
};

// multer لرفع الـ PDF
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, STORAGE_DIR),
  filename: (_, __, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.pdf`)
});
const upload = multer({
  storage,
  fileFilter: (_, file, cb) => cb(null, file.mimetype === 'application/pdf')
});

// إتاحة الملفات بشكل للقراءة عبر /uploads
app.use('/uploads', express.static(STORAGE_DIR));

// ===== APIs =====

// إنشاء/تحديث شهادة (مستخدم داخلي)
app.post('/api/certificates', upload.single('pdf'), (req, res) => {
  try {
    const nationalId = normalize(req.body.nationalId);
    const serial     = normalize(req.body.serial);
    if (!nationalId || !serial || !req.file) {
      if (req.file) fs.unlinkSync(path.join(STORAGE_DIR, req.file.filename));
      return res.status(400).json({ error: 'بيانات ناقصة' });
    }
    const recs = loadRecords();
    const idx = recs.findIndex(r => r.nationalId === nationalId && r.serial === serial);
    if (idx >= 0) {
      if (recs[idx].pdfKey && recs[idx].pdfKey !== req.file.filename) {
        const old = path.join(STORAGE_DIR, path.basename(recs[idx].pdfKey));
        if (fs.existsSync(old)) fs.unlink(old, () => {});
      }
      recs[idx].pdfKey = req.file.filename;
      recs[idx].active = true;
      recs[idx].updatedAt = Date.now();
      saveRecords(recs);
      return res.json({ ok: true, id: recs[idx].id });
    } else {
      const id = crypto.randomUUID();
      recs.push({ id, nationalId, serial, pdfKey: req.file.filename, active: true, createdAt: Date.now() });
      saveRecords(recs);
      return res.json({ ok: true, id });
    }
  } catch (e) {
    if (req.file) fs.unlink(path.join(STORAGE_DIR, req.file.filename), () => {});
    return res.status(500).json({ error: e.message });
  }
});

// توافق مع واجهة الداشبورد (رفع)
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    const nationalId = normalize(req.body.id || req.body.nationalId || req.body.identity || req.body.iqama || req.body.nid);
    const serial     = normalize(req.body.serial || req.body.sn || req.body.code || req.body.certificateSerial);
    if (!nationalId || !serial || !req.file) {
      if (req.file) fs.unlinkSync(path.join(STORAGE_DIR, req.file.filename));
      return res.status(400).json({ error: 'بيانات ناقصة' });
    }
    const recs = loadRecords();
    const idx = recs.findIndex(r => r.nationalId === nationalId && r.serial === serial);
    if (idx >= 0) {
      if (recs[idx].pdfKey && recs[idx].pdfKey !== req.file.filename) {
        const old = path.join(STORAGE_DIR, path.basename(recs[idx].pdfKey));
        if (fs.existsSync(old)) fs.unlink(old, () => {});
      }
      recs[idx].pdfKey = req.file.filename;
      recs[idx].active = true;
      recs[idx].updatedAt = Date.now();
    } else {
      recs.push({ id: crypto.randomUUID(), nationalId, serial, pdfKey: req.file.filename, active: true, createdAt: Date.now() });
    }
    saveRecords(recs);
    return res.json({ ok: true });
  } catch (e) {
    if (req.file) fs.unlink(path.join(STORAGE_DIR, req.file.filename), () => {});
    return res.status(500).json({ error: e.message });
  }
});

// حذف مستخدم من الداشبورد
app.post('/delete-user', (req, res) => {
  const nationalId = normalize(req.body?.id || req.body?.nationalId || req.body?.identity || req.body?.iqama || req.body?.nid);
  const serial     = normalize(req.body?.serial || req.body?.sn || req.body?.code || req.body?.certificateSerial);
  if (!nationalId || !serial) return res.status(400).json({ error: 'بيانات ناقصة' });

  const recs = loadRecords();
  const idx  = recs.findIndex(r => r.nationalId === nationalId && r.serial === serial && r.active);
  if (idx < 0) return res.json({ ok: true });

  const fileAbs = path.join(STORAGE_DIR, path.basename(recs[idx].pdfKey || ''));
  if (fs.existsSync(fileAbs)) fs.unlink(fileAbs, () => {});
  recs.splice(idx, 1);
  saveRecords(recs);
  res.json({ ok: true });
});

// قائمة سريعة للفحص
app.get('/users', (req, res) => {
  res.json(loadRecords().filter(r => r.active).map(r => ({
    nationalId: r.nationalId, serial: r.serial, pdfKey: r.pdfKey
  })));
});

// التحقق من الهوية + التسلسلي (الموقع العام)
app.post('/api/lookup', (req, res) => {
  const nationalId = normalize(
    req.body?.nationalId || req.body?.id || req.body?.identity || req.body?.iqama || req.body?.nid
  );
  const serial = normalize(
    req.body?.serial || req.body?.sn || req.body?.code || req.body?.certificateSerial
  );

  if (!nationalId || !serial) return res.status(400).json({ error: 'بيانات ناقصة' });

  const recs = loadRecords();
  const rec = recs.find(r => r.nationalId === nationalId && r.serial === serial && r.active);
  if (!rec) return res.json({ exists: false });

  const token = Buffer.from(JSON.stringify({
    id: rec.id, ts: Date.now(), nonce: crypto.randomBytes(6).toString('hex')
  })).toString('base64url');

  const base = (process.env.SELF_BASE_URL || '').replace(/\/$/, '');
  const url = `${base}/files/${rec.id}?t=${encodeURIComponent(token)}`;
  res.json({ exists: true, downloadUrl: url });
});

// عرض الملف برابط موقّت
app.get('/files/:id', (req, res) => {
  try {
    const t = req.query.t;
    if (!t) return res.status(403).send('Forbidden');

    let payload;
    try { payload = JSON.parse(Buffer.from(String(t), 'base64url').toString()); }
    catch { return res.status(403).send('Invalid token'); }

    if (payload.id !== req.params.id) return res.status(403).send('Forbidden');
    if (Date.now() - Number(payload.ts) > 2 * 60 * 1000) return res.status(403).send('Link expired');

    const recs = loadRecords();
    const rec = recs.find(r => r.id === req.params.id && r.active);
    if (!rec) return res.status(404).send('Not found');

    const abs = path.join(STORAGE_DIR, path.basename(rec.pdfKey));
    if (!fs.existsSync(abs)) return res.status(404).send('File missing');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    res.status(500).send('Server error');
  }
});

// ===== الملفات الثابتة (الواجهة كما هي) =====
const STATIC_DIR = path.join(__dirname, 'public');
app.use(express.static(STATIC_DIR));
app.use('/rajhi/public', express.static(STATIC_DIR));
app.use('/dashboard-panel-main/public', express.static(STATIC_DIR));
app.use('/dashboard', express.static(STATIC_DIR));

app.get('/', (req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));

// ===== التشغيل =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Dashboard backend running on', PORT, 'serving', STATIC_DIR));
