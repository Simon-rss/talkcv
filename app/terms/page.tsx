import { PublicPage, SUPPORT_EMAIL, type PublicPageProps } from "../public-navigation";

export const metadata = { title: "Terms, Acceptable Use & Refunds · 服务条款与使用政策", alternates: { canonical: "/terms" } };

export default async function TermsPage({ searchParams }: PublicPageProps) {
  const en = (await searchParams).lang === "en";
  return <PublicPage path="/terms" lang={en ? "en" : "zh"} title={en ? "Terms of Service, Acceptable Use & Refunds" : "服务条款、可接受使用政策与退款说明"}>
    <article className="af-policy">
      <h2>{en ? "Creating and sharing a résumé" : "创建与分享简历"}</h2>
      <p>{en ? "TalkCV hosts interactive résumés and provides AI writing, avatar, and visitor chat tools. Upload only material you have permission to share. You retain ownership of your content and authorize TalkCV to process and host it according to your publishing settings. Review AI-generated statements before publishing." : "TalkCV 提供简历托管、AI 写作、头像生成与访客对话服务。请仅上传有权分享的材料。你保留内容所有权，并授权 TalkCV 根据发布设置处理、展示这些内容。发布前请核实 AI 生成的描述。"}</p>

      <h2 id="aup">{en ? "Acceptable Use Policy (AUP)" : "可接受使用政策（AUP）"}</h2>
      <p>{en ? "TalkCV Studio provides AI résumé generation, AI live editing, AI portrait generation, and visitor AI chat. By using TalkCV, you strictly agree NOT to generate, upload, host, or solicit any of the following:" : "TalkCV Studio 提供 AI 简历生成、AI 实时精修、AI 头像生成及访客 AI 对话能力。使用本服务即表示你严格同意不得生成、上传、托管或诱导以下任何内容："}</p>
      <ul>
        <li>{en ? "Illegal content or activities, including fraud, identity impersonation, forged credentials, or intellectual property infringement." : "非法内容或活动，包括欺诈、冒充他人身份、伪造履历资质或侵犯知识产权。"}</li>
        <li>{en ? "Abusive, harassing, hateful, threatening, violent, or defamatory content." : "虐待、骚扰、仇恨、威胁、暴力或诽谤性内容。"}</li>
        <li>{en ? "Sexual, explicit, pornographic, or NSFW text, imagery, or avatars." : "色情、露骨、性暗示或任何 NSFW 文本、图片与头像。"}</li>
        <li>{en ? "Malware, spam, phishing links, automated abuse, or attempts to bypass quotas and safety guardrails." : "恶意软件、垃圾信息、钓鱼链接、自动化滥用或试图绕过额度与安全限制的行为。"}</li>
      </ul>
      <p>{en ? "We reserve the right to immediately remove violating sites and suspend or terminate accounts that breach this Acceptable Use Policy." : "如发现违反本可接受使用政策的站点或账号，我们有权立即下线相关内容并中止或终止服务。"}</p>

      <h2>{en ? "Subscriptions and cancellation" : "订阅与取消"}</h2>
      <p>{en ? "Free has no subscription fee (3 AI generations per account). Pro ($20/month or $190/year) and Max ($49/month or $469/year) renew at the monthly or yearly interval you select. Creem acts as our Merchant of Record and displays the total payable before payment. Open Billing in Studio to manage your subscription and cancel future renewals anytime." : "Free 免订阅费（每账号 3 次体验生成）。Pro（$20/月 或 $190/年）与 Max（$49/月 或 $469/年）按你选择的周期自动续订。Creem 作为官方收款商户（Merchant of Record）在付款前展示实付总额。在工作台打开「管理订阅」可随时取消后续续费。"}</p>

      <h2>{en ? "Requesting a refund & support contact" : "申请退款与客服联系"}</h2>
      <p>{en ? `For support, duplicate charges, undelivered paid features, or statutory refund requests, email TalkCV Support directly at ${SUPPORT_EMAIL} with your order ID, purchase email, and reason. Approved refunds are processed by Creem. Your statutory consumer rights apply.` : `如需技术支持，或遇重复扣款、已付费功能未交付及法定退款需求，请直接发送邮件至 TalkCV 客服邮箱 ${SUPPORT_EMAIL}，并附上订单号、购买邮箱与说明。审核通过的退款由 Creem 原路退回，你依法享有的消费者权利不受影响。`}</p>
      <div className="af-site-links">
        <a href={`mailto:${SUPPORT_EMAIL}`}>{en ? `Email Support (${SUPPORT_EMAIL})` : `联系客服（${SUPPORT_EMAIL}）`}</a>
        <a href="https://www.creem.io/contact">{en ? "Creem support" : "Creem 付款支持"}</a>
        <a href="https://www.creem.io/buyer-terms">{en ? "Creem buyer terms" : "Creem 买家条款"}</a>
      </div>
    </article>
  </PublicPage>;
}
