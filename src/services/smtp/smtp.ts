import nodemailer from "nodemailer";
import { config } from "./config"; // Import the configuration object

export class EmailService {
  private transporter: any;

  constructor() {
    // Initialize transporter using the configuration object
    this.transporter = nodemailer.createTransport(config.smtp);
  }

  async sendEmail(to: string, subject: string, html: string, text?: string) {
    const mailOptions = {
      from: "hello@mail.camped.ai", // Sender address
      to,
      subject,
      html,
      text,
    };

    await this.transporter.sendMail(mailOptions);
  }
}
