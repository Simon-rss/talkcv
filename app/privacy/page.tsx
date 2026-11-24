import { PublicPage, SUPPORT_EMAIL, type PublicPageProps } from "../public-navigation";

export const metadata = { title: "Privacy Policy · 隐私政策", alternates: { canonical: "/privacy" } };

export default async function PrivacyPage({ searchParams }: PublicPageProps) {
  const en = (await searchParams).lang === "en";
  return <PublicPage path="/privacy" lang={en ? "en" : "zh"} title={en ? "Privacy Policy" : "隐私政策"}>
    <article className="af-policy">
      <h2>{en ? "Account, billing and AI processing" : "账号、账单与 AI 处理"}</h2>
      <p>{en ? "TalkCV uses your email to verify your account, track plan usage and associate sites with you. Creem handles checkout and provides subscription status. When you use AI features, the selected model provider receives the résumé, instructions or conversation needed to respond. Site-specific chat API keys are stored encrypted." : "TalkCV 使用邮箱验证身份、记录套餐用量及站点归属。Creem 处理结账并向 TalkCV 提供订阅状态。使用 AI 功能时，所选模型服务商会收到完成任务所需的简历、指令或对话。站点专用的对话 API 密钥加密存储。"}</p>
      <h2>{en ? "Published sites and visitor insights" : "站点访问与访客洞察"}</h2>
      <p>{en ? "Published contact details are visible to visitors who can open the site. Studio lets you request search exclusion or require a passcode. TalkCV counts site views and visitor questions. Paying site owners can see recent question topics and times. Avoid including sensitive details in chat." : "发布的联系方式对有权访问站点的访客可见。你可以在工作台禁止搜索引擎收录，或设置访问口令。TalkCV 统计站点浏览量和提问次数，付费站点作者还可查看近期提问的主题与时间。请避免在对话中填写敏感信息。"}</p>
      <h2>{en ? "Storage, deletion and support contact" : "存储、删除与联系我们"}</h2>
      <p>{en ? `Cookies maintain your session, access permissions and usage limits. Your browser stores Studio drafts and display preferences. You can edit or delete any published site anytime in Studio. For privacy or data deletion requests, email ${SUPPORT_EMAIL}.` : `Cookie 用于维持登录、访问权限及额度。浏览器保存工作台草稿和显示偏好。你可以随时在工作台编辑或删除已发布站点。如需隐私咨询或数据删除请求，请联系客服邮箱 ${SUPPORT_EMAIL}。`}</p>
      <div className="af-site-links">
        <a href={`mailto:${SUPPORT_EMAIL}`}>{en ? `Support: ${SUPPORT_EMAIL}` : `客服邮箱：${SUPPORT_EMAIL}`}</a>
        <a href="https://github.com/Simon-rss/talkcv">{en ? "TalkCV open-source repository" : "TalkCV 开源仓库"}</a>
      </div>
    </article>
  </PublicPage>;
}
