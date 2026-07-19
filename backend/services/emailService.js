require('../config/env');

function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM
  };
}

function hasSmtpConfig() {
  const config = getSmtpConfig();
  return Boolean(config.host && config.port && config.user && config.pass && config.from);
}

async function sendPasswordResetEmail({ to, nombre, resetUrl }) {
  if (!hasSmtpConfig()) {
    const error = new Error('SMTP no configurado.');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }

  const nodemailer = require('nodemailer');
  const config = getSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  await transporter.sendMail({
    from: config.from,
    to,
    subject: 'Recuperacion de contrasena - Sistema Gestor',
    text: [
      `Hola ${nombre || 'usuario'},`,
      '',
      'Recibimos una solicitud para restablecer tu contrasena.',
      'El enlace es valido durante 15 minutos:',
      resetUrl,
      '',
      'Si no solicitaste este cambio, ignora este correo.'
    ].join('\n'),
    html: `
      <p>Hola ${nombre || 'usuario'},</p>
      <p>Recibimos una solicitud para restablecer tu contrasena.</p>
      <p><a href="${resetUrl}">Restablecer contrasena</a></p>
      <p>El enlace es valido durante 15 minutos. Si no solicitaste este cambio, ignora este correo.</p>
    `
  });
}

module.exports = {
  hasSmtpConfig,
  sendPasswordResetEmail
};
