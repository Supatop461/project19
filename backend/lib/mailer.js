// backend/lib/mailer.js
const nodemailer = require('nodemailer');

let transporter;

function envBool(v) {
  return String(v).trim().toLowerCase() === 'true';
}
function envStr(v) {
  return (v ?? '').toString().trim();
}

function createTransporter() {
  if (transporter) return transporter;

  const host = envStr(process.env.SMTP_HOST || 'smtp.gmail.com');
  const port = Number(envStr(process.env.SMTP_PORT || '465'));
  const secure = envBool(process.env.SMTP_SECURE || 'true'); // แนะนำ true/465
  const user = envStr(process.env.SMTP_USER);
  const pass = envStr(process.env.SMTP_PASS);

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  if (envBool(process.env.SMTP_DEBUG)) {
    transporter.on('log', (log) => console.log('[SMTP LOG]', log));
    console.log(`[SMTP] host=${host} port=${port} secure=${secure} user=${user}`);
  }

  return transporter;
}

/**
 * ส่งอีเมล
 * @param {Object} opts
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} [opts.html]
 * @param {string} [opts.text]
 */
async function sendMail({ to, subject, html, text }) {
  const trans = createTransporter();
  const from = envStr(process.env.MAIL_FROM || '"No Reply" <no-reply@example.com>');

  try {
    // ตรวจสอบการเชื่อมต่อ/credentials ล่วงหน้า (จะโยน error ถ้า login ไม่ผ่าน)
    await trans.verify();

    const info = await trans.sendMail({
      from,
      to,
      subject,
      html,
      text: text || (html ? stripHtml(html) : undefined),
    });

    console.log(`📧 Email sent to ${to}: ${info.messageId}`);
    if (envBool(process.env.SMTP_DEBUG)) {
      console.log('📨 Preview URL:', nodemailer.getTestMessageUrl(info) || '(none)');
    }
    return true;
  } catch (err) {
    console.error('❌ Email send failed:');
    console.error('  Message:', err.message);
    if (err.command) console.error('  Command:', err.command);
    if (err.response) console.error('  Response:', err.response);
    if (err.responseCode) console.error('  Code:', err.responseCode);

    // Hint เฉพาะ 535
    if (err.responseCode === 535) {
      console.error('  HINT: ตรวจสอบว่าใช้ App Password 16 ตัวถูกบัญชี/ไม่มีช่องว่าง และพอร์ต/secure ตรงกับ Gmail (465/true).');
    }
    return false;
  }
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = { sendMail };
