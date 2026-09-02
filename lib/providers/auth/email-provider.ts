import nodemailer, { type Transporter } from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerMessageId: string | null }>;
}

/** Provider 未配置时的明确错误；路由会把它映射为可理解的服务不可用状态。 */
export class EmailProviderNotConfiguredError extends Error {
  public constructor() {
    super("邮件 Provider 尚未配置");
    this.name = "EmailProviderNotConfiguredError";
  }
}

/** 企业邮箱 SMTP 适配器；连接信息只从运行时环境读取，支持替换为邮件推送 API。 */
export class SmtpEmailProvider implements EmailProvider {
  public constructor(private readonly transporter: Transporter, private readonly from: string) {}

  public static fromEnvironment(environment: Record<string, string | undefined> = process.env): SmtpEmailProvider | null {
    const host = environment.SMTP_HOST?.trim();
    const user = environment.SMTP_USER?.trim();
    const password = environment.SMTP_PASSWORD;
    if (!host || !user || !password) return null;
    const port = Number(environment.SMTP_PORT ?? 465);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT 必须是合法端口");
    const secure = (environment.SMTP_SECURE ?? "true").toLowerCase() !== "false";
    const from = environment.EMAIL_FROM?.trim() || user;
    return new SmtpEmailProvider(nodemailer.createTransport({ host, port, secure, auth: { user, pass: password } }), from);
  }

  public async send(message: EmailMessage): Promise<{ providerMessageId: string | null }> {
    const result = await this.transporter.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
    return { providerMessageId: typeof result.messageId === "string" ? result.messageId : null };
  }
}

/** 读取邮件 Provider；未配置返回 null，调用方必须显式处理而不能伪造“已发送”。 */
export function getEmailProvider(environment: Record<string, string | undefined> = process.env): EmailProvider | null {
  const provider = environment.EMAIL_PROVIDER?.trim().toLowerCase();
  if (!provider || provider === "disabled") return null;
  if (provider === "smtp" || provider === "aliyun_enterprise_mail") return SmtpEmailProvider.fromEnvironment(environment);
  throw new Error(`不支持的邮件 Provider: ${provider}`);
}
