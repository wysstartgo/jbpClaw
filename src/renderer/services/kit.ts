import type { InstalledKit, MarketplaceKit } from '../types/kit';

const QIUSHI_SKILLS = [
  {
    id: 'arming-thought',
    name: { zh: '武装思想', en: 'Arming Thought' },
    description: {
      zh: '建立实事求是总原则，并按任务场景选择下游方法论 Skill。',
      en: 'Establish the fact-first principle and route to downstream methodology skills.',
    },
  },
  {
    id: 'contradiction-analysis',
    name: { zh: '矛盾分析法', en: 'Contradiction Analysis' },
    description: {
      zh: '识别主要矛盾、次要矛盾和矛盾性质，找到复杂问题的主攻方向。',
      en: 'Identify principal contradictions and choose the main line of attack.',
    },
  },
  {
    id: 'practice-cognition',
    name: { zh: '实践认识论', en: 'Practice-Cognition' },
    description: {
      zh: '把方案、假设和判断放回实践中验证，并通过反馈迭代升级认知。',
      en: 'Validate plans through practice and improve understanding through feedback loops.',
    },
  },
  {
    id: 'investigation-first',
    name: { zh: '调查研究', en: 'Investigation First' },
    description: {
      zh: '在事实不充分时先调查，再判断，避免脱离实际的方案和结论。',
      en: 'Investigate before judging when evidence or context is incomplete.',
    },
  },
  {
    id: 'mass-line',
    name: { zh: '群众路线', en: 'Mass Line' },
    description: {
      zh: '收集多方反馈，系统化整理，再返回真实使用者和执行者验证。',
      en: 'Collect, synthesize, and validate feedback with affected users and executors.',
    },
  },
  {
    id: 'criticism-self-criticism',
    name: { zh: '批评与自我批评', en: 'Criticism and Self-Criticism' },
    description: {
      zh: '在交付、验收或复盘阶段诚实检查质量，纠偏并沉淀改进动作。',
      en: 'Review work honestly, correct errors, and turn critique into improvements.',
    },
  },
  {
    id: 'protracted-strategy',
    name: { zh: '持久战略', en: 'Protracted Strategy' },
    description: {
      zh: '面对长期复杂任务时划分阶段，保持战略耐心并积累阶段性胜利。',
      en: 'Divide long-horizon work into stages and accumulate durable progress.',
    },
  },
  {
    id: 'concentrate-forces',
    name: { zh: '集中兵力', en: 'Concentrate Forces' },
    description: {
      zh: '在资源有限、任务分散时确定主攻方向，集中力量打穿一个关键点。',
      en: 'Focus limited resources on one decisive priority before expanding.',
    },
  },
  {
    id: 'spark-prairie-fire',
    name: { zh: '星火燎原', en: 'Spark Prairie Fire' },
    description: {
      zh: '从极小切口建立根据地，验证后再扩张，避免一开始四处散打。',
      en: 'Start from a validated foothold and grow from a durable base.',
    },
  },
  {
    id: 'overall-planning',
    name: { zh: '统筹兼顾', en: 'Overall Planning' },
    description: {
      zh: '在多目标、多约束、多利益方之间做动态平衡，避免片面优化。',
      en: 'Balance competing goals and constraints across a complex system.',
    },
  },
  {
    id: 'workflows',
    name: { zh: '工作流组合', en: 'Workflows' },
    description: {
      zh: '当任务需要多个方法论串联时，定义调用顺序、交接格式和终止条件。',
      en: 'Chain multiple methodology skills with clear order and handoff rules.',
    },
  },
];

export const BUILTIN_QIUSHI_KIT: MarketplaceKit = {
  id: 'qiushi-methodology',
  name: { zh: '求是方法论套件', en: 'Qiushi Methodology Kit' },
  description: {
    zh: '把求是 Skill 的 11 个方法论技能组织成一个 Kit：以实事求是为总原则，按场景调用矛盾分析、调查研究、实践迭代、复盘纠偏等工作方法。',
    en: 'A kit that groups 11 Qiushi methodology skills for fact-first reasoning, contradiction analysis, investigation, practice loops, review, and strategic planning.',
  },
  icon: '🎯',
  author: 'HughYau',
  version: '1.4.1',
  tryAsking: [
    {
      zh: '用求是方法论帮我分析：当前项目最主要的矛盾是什么？',
      en: 'Use the Qiushi methodology to identify the principal contradiction in my current project.',
    },
    {
      zh: '先调查再判断，帮我规划一个复杂问题的推进路径。',
      en: 'Investigate first, then plan the path for a complex problem.',
    },
    {
      zh: '对刚完成的方案做一次批评与自我批评式复盘。',
      en: 'Review the completed plan with criticism and self-criticism.',
    },
  ],
  skills: {
    bundle: 'builtin://qiushi-methodology',
    list: QIUSHI_SKILLS,
  },
  mcpServers: null,
  connectors: null,
};

const CHEAT_ON_CONTENT_SKILLS = [
  {
    id: 'cheat-on-content',
    name: { zh: '网红作弊器', en: 'Cheat on Content' },
    description: {
      zh: '把内容创作变成可校准预测循环：打分、盲预测、发布、复盘和升级 rubric，内部路由到 cheat-score、cheat-predict、cheat-retro 等子流程。',
      en: 'Turn content creation into a calibrated prediction loop for scoring, blind prediction, publishing, retrospectives, and rubric improvement.',
    },
  },
];

const NOVEL_COMIC_WECHAT_POST_SKILLS = [
  {
    id: 'novel-comic-wechat-post',
    name: { zh: '小说漫画公众号推文', en: 'Novel Comic WeChat Post' },
    description: {
      zh: '把小说章节、人物线或名场面改编成漫画图文公众号推文，串联方案、分镜、封面、绘图、排版和发布检查点。',
      en: 'Turn novel chapters, character arcs, or iconic scenes into comic-style WeChat public-account posts with planning, storyboard, cover, images, formatting, and publishing checkpoints.',
    },
  },
  {
    id: 'explosive-cover-generator-gzh',
    name: { zh: '公众号爆款封面策划', en: 'Explosive WeChat Cover Strategy' },
    description: {
      zh: '复用已安装的封面策划能力，分析同赛道爆款封面规律并输出封面方案与提示词。',
      en: 'Reuse the installed cover strategy skill to analyze high-performing covers and produce schemes and prompts.',
    },
  },
  {
    id: 'qingshu-image',
    name: { zh: '专用绘图 Skill', en: 'Dedicated Image Generation Skill' },
    description: {
      zh: 'JBPClaw 内置专用绘图能力，用于生成公众号封面和漫画页，替代 codex-image 或外部 API Key 绘图。',
      en: 'JBPClaw built-in dedicated image generation skill for covers and comic pages, replacing codex-image or API-key based image tools.',
    },
  },
  {
    id: 'xiaohu-wechat-format',
    name: { zh: '公众号排版发布', en: 'WeChat Formatting and Publishing' },
    description: {
      zh: '复用已安装的 xiaohu 发稿流水线，负责 Markdown 排版、正文图片处理、封面上传和公众号草稿推送。',
      en: 'Reuse the installed xiaohu publishing pipeline for Markdown formatting, image handling, cover upload, and WeChat draft publishing.',
    },
  },
];

const DBS_SKILLS = [
  {
    id: 'dbs',
    name: { zh: 'dbs 商业工具箱入口', en: 'DBS Business Toolkit Router' },
    description: {
      zh: 'dontbesilent 商业工具箱主入口，根据问题自动路由到合适的诊断工具。',
      en: 'Main router for the dontbesilent business toolkit.',
    },
  },
  {
    id: 'dbs-action',
    name: { zh: '执行力诊断', en: 'Execution Block Diagnosis' },
    description: {
      zh: '用阿德勒心理学框架诊断知道该做什么但就是不做的真正原因。',
      en: 'Diagnose execution blocks with an Adlerian psychology framework.',
    },
  },
  {
    id: 'dbs-agent-migration',
    name: { zh: 'Agent 工作台迁移', en: 'Agent Workspace Migration' },
    description: {
      zh: '整理 Claude Code、Codex、Grok 三端一致的 Agent 工作台规则、真源和 bridge。',
      en: 'Normalize agent workspaces across Claude Code, Codex, and Grok.',
    },
  },
  {
    id: 'dbs-ai-check',
    name: { zh: 'AI 写作特征识别', en: 'AI Writing Check' },
    description: {
      zh: '扫描文案中的 AI 生成痕迹，默认只诊断不改写。',
      en: 'Detect AI writing fingerprints in copy without rewriting by default.',
    },
  },
  {
    id: 'dbs-benchmark',
    name: { zh: '对标分析', en: 'Benchmark Analysis' },
    description: {
      zh: '用五重过滤法找到真正值得模仿的对标对象。',
      en: 'Find useful benchmarks with a five-filter method.',
    },
  },
  {
    id: 'dbs-chatroom',
    name: { zh: '定向聊天室', en: 'Directed Chatroom' },
    description: {
      zh: '根据话题推荐或接受用户指定专家，模拟多角色对话。',
      en: 'Run multi-role discussions with recommended or user-selected experts.',
    },
  },
  {
    id: 'dbs-chatroom-austrian',
    name: { zh: '奥派经济学聊天室', en: 'Austrian Economics Chatroom' },
    description: {
      zh: '哈耶克、米塞斯与 Claude 的奥派经济学视角多角色讨论。',
      en: 'A Hayek, Mises, and Claude multi-role Austrian economics discussion.',
    },
  },
  {
    id: 'dbs-content',
    name: { zh: '内容创作诊断', en: 'Content Creation Diagnosis' },
    description: {
      zh: '选题通过后，诊断如何把选题做成好内容。',
      en: 'Diagnose how to turn a validated topic into strong content.',
    },
  },
  {
    id: 'dbs-content-system',
    name: { zh: '内容结构化系统', en: 'Content Structuring System' },
    description: {
      zh: '把本地内容资产搭成可复用、可追溯、可重组的内容工程。',
      en: 'Turn local content archives into reusable structured content systems.',
    },
  },
  {
    id: 'dbs-decision',
    name: { zh: '个人决策系统', en: 'Personal Decision System' },
    description: {
      zh: '把长期领域决策沉淀为本地知识工程和可复盘概念库。',
      en: 'Build long-running decision domains into local knowledge systems.',
    },
  },
  {
    id: 'dbs-deconstruct',
    name: { zh: '概念拆解', en: 'Concept Deconstruction' },
    description: {
      zh: '用维特根斯坦和奥派经济学方法拆解模糊商业概念。',
      en: 'Deconstruct fuzzy business concepts with Wittgensteinian and Austrian lenses.',
    },
  },
  {
    id: 'dbs-diagnosis',
    name: { zh: '商业模式诊断', en: 'Business Model Diagnosis' },
    description: {
      zh: '通过问诊和体检两种模式消解商业问题、拆解商业模式。',
      en: 'Diagnose business models through consultation and checkup modes.',
    },
  },
  {
    id: 'dbs-goal',
    name: { zh: '目标清晰化', en: 'Goal Clarification' },
    description: {
      zh: '把模糊目标审计成可检查的交付物。',
      en: 'Audit fuzzy goals into checkable deliverables.',
    },
  },
  {
    id: 'dbs-good-question',
    name: { zh: '好问题生成器', en: 'Good Question Generator' },
    description: {
      zh: '把模糊问题改成 Agent 可推理、可批评、可验证的问题说明书。',
      en: 'Turn fuzzy problems into agent-solvable problem briefs.',
    },
  },
  {
    id: 'dbs-hook',
    name: { zh: '短视频开头优化', en: 'Short Video Hook Optimization' },
    description: {
      zh: '诊断短视频开头问题并生成优化方案。',
      en: 'Diagnose and improve short video openings.',
    },
  },
  {
    id: 'dbs-learning',
    name: { zh: '交互式学习', en: 'Interactive Learning' },
    description: {
      zh: '根据用户反馈连续生成学习文章，调整深度、角度和节奏。',
      en: 'Build adaptive learning article sequences from user feedback.',
    },
  },
  {
    id: 'dbs-report',
    name: { zh: '诊断报告生成', en: 'Diagnosis Report Generation' },
    description: {
      zh: '把多次 dbs-save 存档合并为可交付 Markdown 报告。',
      en: 'Merge saved diagnosis snapshots into deliverable Markdown reports.',
    },
  },
  {
    id: 'dbs-restore',
    name: { zh: '诊断状态恢复', en: 'Diagnosis Restore' },
    description: {
      zh: '恢复上次由 dbs-save 保存的诊断状态。',
      en: 'Restore the latest diagnosis snapshot saved by dbs-save.',
    },
  },
  {
    id: 'dbs-save',
    name: { zh: '诊断状态保存', en: 'Diagnosis Save' },
    description: {
      zh: '把当前诊断关键状态保存到本地，供后续接续。',
      en: 'Save current diagnosis state locally for later continuation.',
    },
  },
  {
    id: 'dbs-slowisfast',
    name: { zh: '慢就是快', en: 'Slow Is Fast' },
    description: {
      zh: '找到看起来更慢但长期更快、能通过摩擦建造资产的方法。',
      en: 'Find slower-looking methods that build durable assets through friction.',
    },
  },
  {
    id: 'dbs-xhs-title',
    name: { zh: '小红书标题公式', en: 'Xiaohongshu Title Formulas' },
    description: {
      zh: '从 75 个验证过的爆款公式中匹配合适的小红书标题。',
      en: 'Select from 75 proven Xiaohongshu title formulas.',
    },
  },
];

const OCEANENGINE_SKILLS = [
  {
    id: 'oceanengine-account-auth-funds',
    name: { zh: '账户、鉴权与资金', en: 'Account, Auth, and Funds' },
    description: {
      zh: '处理 OceanEngine 账户、鉴权与资金相关需求，优先使用本域 Tool-Range 白名单。',
      en: 'Handle OceanEngine account, authentication, and funds tasks with a domain-specific tool range.',
    },
  },
  {
    id: 'oceanengine-agent-finance-and-organization',
    name: { zh: '代理商、组织与结算', en: 'Agent Finance and Organization' },
    description: {
      zh: '处理代理商、组织与结算相关需求，限定在本域工具白名单内。',
      en: 'Handle agent, organization, and settlement workflows within a scoped tool range.',
    },
  },
  {
    id: 'oceanengine-audience-and-dmp',
    name: { zh: '人群包与 DMP 数据资产', en: 'Audience and DMP Assets' },
    description: {
      zh: '处理人群包、DMP 数据资产与定向相关需求。',
      en: 'Handle audience package, DMP asset, and targeting workflows.',
    },
  },
  {
    id: 'oceanengine-campaign-build-and-delivery',
    name: { zh: '项目、广告与投放搭建', en: 'Campaign Build and Delivery' },
    description: {
      zh: '处理项目、广告、预算组、出价、关键词与投放结构化搭建。',
      en: 'Handle campaign, ad, budget, bid, keyword, and delivery structure workflows.',
    },
  },
  {
    id: 'oceanengine-catalog-and-dpa',
    name: { zh: '商品库、资产共享与 DPA', en: 'Catalog and DPA' },
    description: {
      zh: '处理商品库、资产共享与 DPA 相关需求。',
      en: 'Handle catalog, asset sharing, and DPA workflows.',
    },
  },
  {
    id: 'oceanengine-creative-and-material-assets',
    name: { zh: '创意、素材与审核资产', en: 'Creative and Material Assets' },
    description: {
      zh: '处理创意、素材与审核资产相关需求。',
      en: 'Handle creative, material, and review-asset workflows.',
    },
  },
  {
    id: 'oceanengine-ecosystem-and-app-assets',
    name: { zh: '应用生态、小程序与渠道资产', en: 'Ecosystem and App Assets' },
    description: {
      zh: '处理应用生态、小程序与渠道资产相关需求。',
      en: 'Handle app ecosystem, mini-app, and channel asset workflows.',
    },
  },
  {
    id: 'oceanengine-engagement-and-channel-ops',
    name: { zh: '评论运营与渠道增效', en: 'Engagement and Channel Ops' },
    description: {
      zh: '处理评论运营与渠道增效相关需求。',
      en: 'Handle engagement operations and channel optimization workflows.',
    },
  },
  {
    id: 'oceanengine-lead-and-conversion-ops',
    name: { zh: '线索、转化与承接链路', en: 'Lead and Conversion Ops' },
    description: {
      zh: '处理线索、转化与承接链路相关需求。',
      en: 'Handle lead, conversion, and handoff-chain workflows.',
    },
  },
  {
    id: 'oceanengine-reporting-and-diagnostics',
    name: { zh: '报表、洞察与诊断', en: 'Reporting and Diagnostics' },
    description: {
      zh: '处理报表、洞察、诊断和数据分析相关需求。',
      en: 'Handle reporting, insight, diagnostics, and analysis workflows.',
    },
  },
  {
    id: 'oceanengine-site-and-landing-assets',
    name: { zh: '站点、落地页与模板', en: 'Site and Landing Assets' },
    description: {
      zh: '处理站点、落地页与模板相关需求。',
      en: 'Handle site, landing page, and template asset workflows.',
    },
  },
];

export const BUILTIN_CHEAT_ON_CONTENT_KIT: MarketplaceKit = {
  id: 'cheat-on-content-kit',
  name: { zh: '内容预测与打分套件', en: 'Cheat on Content Kit' },
  description: {
    zh: '把 cheat-on-content 包装成一个 Kit：面向公众号、视频、播客等内容形态，提供内容打分、盲预测、发布后复盘和 rubric 迭代能力。',
    en: 'A kit that packages cheat-on-content for scoring, blind prediction, post-publish retrospectives, and rubric iteration across content formats.',
  },
  icon: '📈',
  author: 'HughYau',
  version: '1.4.0',
  tryAsking: [
    {
      zh: '用 cheat-on-content 给这篇公众号稿打分，并指出低于 8 分要怎么优化。',
      en: 'Use cheat-on-content to score this WeChat article draft and suggest improvements if it is below 8/10.',
    },
    {
      zh: '初始化 cheat-on-content，帮我建立内容打分和复盘工作台。',
      en: 'Initialize cheat-on-content and set up a scoring and retrospective workspace.',
    },
    {
      zh: '对这篇内容启动发布前盲预测，并生成后续复盘记录。',
      en: 'Start a pre-publish blind prediction for this content and prepare a retrospective record.',
    },
  ],
  skills: {
    bundle: 'builtin://cheat-on-content-kit',
    list: CHEAT_ON_CONTENT_SKILLS,
  },
  mcpServers: null,
  connectors: null,
};

export const BUILTIN_NOVEL_COMIC_WECHAT_POST_KIT: MarketplaceKit = {
  id: 'novel-comic-wechat-post-kit',
  name: { zh: '小说漫画公众号推文套件', en: 'Novel Comic WeChat Post Kit' },
  description: {
    zh: '把小说漫画公众号推文主流程包装成一个 Kit：主编排 Skill 负责章节证据、分镜和文章，封面策划复用已安装的 explosive-cover-generator-gzh，绘图统一走 JBPClaw 内置专用绘图 Skill，排版发布复用已安装的 xiaohu-wechat-format。',
    en: 'A kit for comic-style novel WeChat posts: the main skill orchestrates evidence, storyboard, and article writing; cover planning reuses explosive-cover-generator-gzh; image generation uses JBPClaw dedicated image generation; formatting and publishing reuse xiaohu-wechat-format.',
  },
  icon: '📚',
  author: 'JBPClaw',
  version: '2026.06.09',
  tryAsking: [
    {
      zh: '把这段小说名场面做成漫画公众号推文，先出方案和分镜。',
      en: 'Turn this iconic novel scene into a comic-style WeChat article, starting with a plan and storyboard.',
    },
    {
      zh: '基于这条人物线，生成公众号封面方案、漫画页提示词和文章草稿。',
      en: 'Generate cover schemes, comic page prompts, and an article draft from this character arc.',
    },
    {
      zh: '把这篇小说漫画推文排版成公众号兼容 HTML，但先不要发布。',
      en: 'Format this novel comic post into WeChat-compatible HTML without publishing it yet.',
    },
  ],
  skills: {
    bundle: 'builtin://novel-comic-wechat-post-kit',
    list: NOVEL_COMIC_WECHAT_POST_SKILLS,
  },
  mcpServers: null,
  connectors: null,
};

export const BUILTIN_OCEANENGINE_KIT: MarketplaceKit = {
  id: 'oceanengine-mcp-domain-kit',
  name: { zh: '巨量引擎 MCP 分域套件', en: 'OceanEngine MCP Domain Kit' },
  description: {
    zh: '把 OceanEngine AD MCP 的 11 个分域 Skill 组织成一个 Kit：按账户资金、投放搭建、素材资产、人群 DMP、报表诊断、线索转化等域隔离工具范围。',
    en: 'A kit packaging 11 OceanEngine AD MCP domain skills with scoped tool ranges for account funds, campaign delivery, assets, DMP, reporting, leads, and related workflows.',
  },
  icon: '🌊',
  author: 'JBPClaw',
  version: '2026.06.09',
  tryAsking: [
    {
      zh: '用巨量引擎 MCP 分域套件帮我判断这个投放需求应该走哪个域。',
      en: 'Use the OceanEngine MCP domain kit to route this advertising task to the right domain.',
    },
    {
      zh: '检查这个项目、广告和预算组结构是否适合当前投放目标。',
      en: 'Check whether this campaign, ad, and budget structure fits the current delivery goal.',
    },
    {
      zh: '基于现有报表数据做一次投放诊断，并说明需要读取哪些工具。',
      en: 'Run a delivery diagnosis from current reporting data and explain which tools are needed.',
    },
  ],
  skills: {
    bundle: 'builtin://oceanengine-mcp-domain-kit',
    list: OCEANENGINE_SKILLS,
  },
  mcpServers: null,
  connectors: null,
};

export const BUILTIN_DBS_KIT: MarketplaceKit = {
  id: 'dontbesilent-business-kit',
  name: { zh: 'dontbesilent 商业工具箱套件', en: 'dontbesilent Business Toolkit' },
  description: {
    zh: '把 dbskill v2.14.2 的 21 个 dontbesilent 商业诊断、内容、决策、学习和 Agent 工作台 Skill 组织成一个 Kit。',
    en: 'A kit packaging the 21 dbskill v2.14.2 dontbesilent business, content, decision, learning, and agent-workspace skills.',
  },
  icon: '🧭',
  author: 'dontbesilent',
  version: '2.14.2',
  tryAsking: [
    {
      zh: '用 dbs 商业工具箱帮我判断这个业务问题该走哪个诊断流程。',
      en: 'Use the DBS business toolkit to route this business problem to the right diagnostic workflow.',
    },
    {
      zh: '用 dbs-diagnosis 给我的商业模式做一次问诊。',
      en: 'Use dbs-diagnosis to review my business model.',
    },
    {
      zh: '用 dbs-content-system 帮我规划一套内容资产结构化工程。',
      en: 'Use dbs-content-system to plan a structured content asset project.',
    },
  ],
  skills: {
    bundle: 'builtin://dontbesilent-business-kit',
    list: DBS_SKILLS,
  },
  mcpServers: null,
  connectors: null,
};

const BUILTIN_KITS = [
  BUILTIN_NOVEL_COMIC_WECHAT_POST_KIT,
  BUILTIN_OCEANENGINE_KIT,
  BUILTIN_DBS_KIT,
  BUILTIN_CHEAT_ON_CONTENT_KIT,
  BUILTIN_QIUSHI_KIT,
];

class KitService {
  private marketplaceCache: MarketplaceKit[] | null = null;
  private fetchPromise: Promise<MarketplaceKit[]> | null = null;

  async fetchMarketplaceKits(): Promise<MarketplaceKit[]> {
    if (this.marketplaceCache) {
      return this.marketplaceCache;
    }
    if (this.fetchPromise) {
      return this.fetchPromise;
    }
    this.fetchPromise = this.loadMarketplaceKits();
    const result = await this.fetchPromise;
    this.fetchPromise = null;
    return result;
  }

  private async loadMarketplaceKits(): Promise<MarketplaceKit[]> {
    try {
      const result = await window.electron.kits.fetchStore();
      if (!result.success || !result.data) {
        console.warn('[KitService] Failed to fetch kit store:', result.error);
        return [];
      }

      const parsed = JSON.parse(result.data);
      // overmind response: { data: { value: { ... } } }
      const value = parsed?.data?.value;
      if (!value) {
        console.warn('[KitService] Unexpected kit store response structure');
        return [];
      }

      const kits: MarketplaceKit[] = value.kits ?? [];
      const merged = this.mergeBuiltinKits(kits);
      this.marketplaceCache = merged;
      return merged;
    } catch (error) {
      console.error('[KitService] Error loading marketplace kits:', error);
      return this.mergeBuiltinKits([]);
    }
  }

  private mergeBuiltinKits(kits: MarketplaceKit[]): MarketplaceKit[] {
    const existingKitIds = new Set(kits.map((kit) => kit.id));
    return [
      ...BUILTIN_KITS.filter((kit) => !existingKitIds.has(kit.id)),
      ...kits,
    ];
  }

  async installKit(kit: MarketplaceKit): Promise<{ success: boolean; error?: string }> {
    if (!kit.skills?.bundle) {
      return { success: false, error: 'Kit has no skill bundle URL' };
    }

    const result = await window.electron.kits.install({
      kitId: kit.id,
      bundleUrl: kit.skills.bundle,
      version: kit.version ?? '0.0.0',
      skillListIds: kit.skills.list.map(s => s.id),
      skillList: kit.skills.list,
      mcpServers: kit.mcpServers ?? null,
      connectors: kit.connectors ?? null,
    });

    return result;
  }

  async uninstallKit(kitId: string): Promise<{ success: boolean; error?: string }> {
    return window.electron.kits.uninstall(kitId);
  }

  async getInstalledKits(): Promise<Record<string, InstalledKit>> {
    const result = await window.electron.kits.listInstalled();
    if (!result.success || !result.installed) {
      return {};
    }
    return result.installed;
  }

  clearCache(): void {
    this.marketplaceCache = null;
  }
}

export const kitService = new KitService();
