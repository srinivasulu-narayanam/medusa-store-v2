export const config = {
    smtp: {
      host: "smtp.camped.ai",
      port: 2465,
      secure: true,
      auth: {
        user: "camped",
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    },
  };