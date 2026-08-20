/* ═══════════════════════════════════════════
   CoupleLife 配置文件
   部署时在 Vercel 后台配置环境变量后，
   请把下面两个 SUPABASE 值替换为你的项目真实值，
   或直接在应用内"设置"页填写（推荐，无需改代码）。
   ═══════════════════════════════════════════ */

const CONFIG = {
  // Supabase 项目地址（形如 https://xxxx.supabase.co）
  SUPABASE_URL: '',

  // Supabase anon 公钥
  SUPABASE_ANON_KEY: '',

  // 情侣固定 ID（不可变，数据隔离依据）
  COUPLE_ID: 'couple_001',

  // AI 提供商默认模型映射
  AI_PROVIDERS: {
    openai: {
      name: 'OpenAI (GPT-4-Vision)',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKeyEnv: 'OPENAI_API_KEY'
    },
    deepseek: {
      name: 'DeepSeek-VL',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-vl',
      apiKeyEnv: 'DEEPSEEK_API_KEY'
    },
    kimi: {
      name: 'Kimi (Moonshot-Vision)',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-8k-vision-preview',
      apiKeyEnv: 'KIMI_API_KEY'
    },
    custom: {
      name: '自定义',
      baseUrl: '',
      model: '',
      apiKeyEnv: 'CUSTOM_AI_API_KEY'
    }
  },

  // AI 固定提示词
  AI_PROMPT: '请判断这张图片或链接属于哪个模块（菜谱、排班表、付款凭证、纪念日照片、健康记录），并提取关键字段，严格按照 JSON 格式返回：{ "module": "模块名", "data": { ... } }',

  // 账本分类（支出 / 收入分开）
  EXPENSE_CATEGORIES: ['餐饮', '购物', '房租', '水电', '交通', '娱乐', '医疗', '宠物', '其他'],
  INCOME_CATEGORIES: ['工资', '投资', '理财', '红包', '奖金', '兼职', '报销', '其他'],
  TX_CATEGORY_ICONS: {
    '餐饮': '🍜', '购物': '🛍️', '房租': '🏠', '水电': '💡', '交通': '🚌',
    '娱乐': '🎮', '医疗': '💊', '宠物': '🐱', '工资': '💼', '投资': '📈',
    '理财': '💰', '红包': '🧧', '奖金': '🏆', '兼职': '🧑‍💻', '报销': '🧾',
    '其他': '📦'
  },

  // 排班类型：白班 / 晚班 / 夜班 / 休息 / 出差
  SCHEDULE_TYPES: {
    'day': { name: '白班', color: '#adb5bd' },
    'evening': { name: '晚班', color: '#9775fa' },
    'night': { name: '夜班', color: '#4dabf7' },
    'rest': { name: '休息', color: '#40c057' },
    'trip': { name: '出差', color: '#fd7e14' }
  }
};

/* 读取配置：优先 Vercel 注入的全局变量（构建时替换），其次 LocalStorage */
function getConfig(key) {
  try {
    // 检查 window 上是否有 Vercel 注入的环境变量（在 index.html 内联替换）
    if (window.__ENV__ && window.__ENV__[key]) return window.__ENV__[key];
  } catch (e) {}
  const ls = localStorage.getItem('cl_config_' + key);
  return ls !== null ? ls : CONFIG[key] || '';
}

function saveConfig(key, value) {
  localStorage.setItem('cl_config_' + key, value);
}
