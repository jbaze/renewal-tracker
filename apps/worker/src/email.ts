/**
 * The email adapter. The worker only knows this interface; the console
 * sender is the default for local runs, the SMTP sender points at Mailpit
 * from docker compose, and tests use the in-memory one.
 */
import nodemailer from 'nodemailer';

export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class ConsoleSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.log(
      `[email] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}\n`,
    );
  }
}

export class MemorySender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export class SmtpSender implements EmailSender {
  private readonly transport;

  constructor(
    options: { host: string; port: number },
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: false,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
