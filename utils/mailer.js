import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendVerificationEmail = async (email, token) => {
  const url = `${process.env.CLIENT_URL}/verify/${token}`;
  await transporter.sendMail({
    from: `"Keyvia App" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Verify Your Email",
    html: `<p>Click <a href="${url}">here</a> to verify your email.</p>`,
  });
};
