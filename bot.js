import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import * as cheerio from "cheerio";
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error("❌ متغیر BOT_TOKEN تنظیم نشده است!");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

let CHAT_ID = null;
let priceAlerts = [2350, 2365, 2330];
let triggered = {};
const notifiedEvents = new Set();

const CHECK_PRICE_INTERVAL = 15000; // هر ۱۵ ثانیه
const CHECK_NEWS_INTERVAL = 60000;  // هر ۱ دقیقه

// =====================
// دریافت قیمت طلا (XAU/USD)
// =====================
async function getGoldPrice() {
  try {
    const res = await axios.get("https://api.metals.live/v1/spot", { timeout: 8000 });
    if (res.data && res.data[0] && res.data[0].gold) {
      return parseFloat(res.data[0].gold);
    }
    return null;
  } catch (err) {
    console.error("Gold fetch error:", err.message);
    return null;
  }
}

// =====================
// بررسی آستانه‌های قیمتی
// =====================
async function checkPrice() {
  if (!CHAT_ID) return;

  const price = await getGoldPrice();
  if (!price) return;

  priceAlerts.forEach((level) => {
    if (price >= level && !triggered[level]) {
      bot.sendMessage(CHAT_ID, `🚨 *هشدار قیمت طلا*\nنرخ فعلی به سطح تعیین‌شده رسید:\n💰 **${price} $** (سطح: ${level})`, {
        parse_mode: "Markdown"
      });
      triggered[level] = true;
    }
    // بازنشانی وضعیت هنگام برگشت قیمت به زیر سطح
    if (price < level - 1) {
      triggered[level] = false;
    }
  });
}

// =====================
// دریافت تقویم اقتصادی و اخبار پرتاثیر
// =====================
async function getForexNews() {
  try {
    const { data } = await axios.get("https://www.forexfactory.com/calendar", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 10000
    });
    const $ = cheerio.load(data);
    const news = [];

    $(".calendar__row").each((i, el) => {
      const impact = $(el).find(".impact span").attr("class") || $(el).find(".impact").attr("title") || "";
      const time = $(el).find(".calendar__time").text().trim();
      const currency = $(el).find(".calendar__currency").text().trim();
      const title = $(el).find(".calendar__event-title").text().trim();

      // فیلتر خبرهای پرتاثیر (High Impact) و مرتبط با USD/طلا
      if ((impact.toLowerCase().includes("red") || impact.toLowerCase().includes("high")) && title) {
        news.push({ time: time || "امروز", currency, title });
      }
    });

    return news;
  } catch (err) {
    console.error("Forex news error:", err.message);
    return [];
  }
}

// =====================
// اطلاع‌رسانی اخبار
// =====================
async function checkNews() {
  if (!CHAT_ID) return;

  const news = await getForexNews();
  if (news.length === 0) return;

  for (const item of news) {
    const eventKey = `${item.time}-${item.currency}-${item.title}`;
    if (!notifiedEvents.has(eventKey)) {
      notifiedEvents.add(eventKey);
      await bot.sendMessage(
        CHAT_ID,
        `⚠️ *خبر اقتصادی با ضریب تاثیر بالا (High Impact)*\n\n📌 **${item.title}**\n💵 ارز: ${item.currency}\n⏰ زمان: ${item.time}`,
        { parse_mode: "Markdown" }
      );
    }
  }
}

// =====================
// دستورات بات تلگرام
// =====================
bot.onText(/\/start/, (msg) => {
  CHAT_ID = msg.chat.id;
  bot.sendMessage(
    CHAT_ID,
    `🤖 دستیار معاملاتی فعال شد!\n\nدستورات:\n➕ \`/add 2400\` : افزودن سطح قیمت جدید\n📋 \`/list\` : مشاهده لیست سطوح هشدار\n❌ \`/clear\` : پاک‌کردن هشدارها\n📊 \`/gold\` : دریافت آنی قیمت طلا`
  );
});

bot.onText(/\/add (.+)/, (msg, match) => {
  const price = parseFloat(match[1]);
  if (!isNaN(price)) {
    priceAlerts.push(price);
    bot.sendMessage(msg.chat.id, `✅ سطح قیمت **${price}** با موفقیت ذخیره شد.`);
  } else {
    bot.sendMessage(msg.chat.id, "❌ لطفاً یک عدد معتبر وارد کنید (مثال: `/add 2380`)");
  }
});

bot.onText(/\/list/, (msg) => {
  if (priceAlerts.length === 0) {
    return bot.sendMessage(msg.chat.id, "هیچ سطحی تنظیم نشده است.");
  }
  const list = priceAlerts.map((p, i) => `${i + 1}. ${p} $`).join("\n");
  bot.sendMessage(msg.chat.id, `📋 سطوح تعیین‌شده برای هشدار:\n\n${list}`);
});

bot.onText(/\/clear/, (msg) => {
  priceAlerts = [];
  triggered = {};
  bot.sendMessage(msg.chat.id, "🧹 تمام سطوح هشدارهای قیمتی حذف شدند.");
});

bot.onText(/\/gold/, async (msg) => {
  const price = await getGoldPrice();
  if (price) {
    bot.sendMessage(msg.chat.id, `🟡 قیمت لحظه‌ای طلا (XAU/USD): **${price} $**`, { parse_mode: "Markdown" });
  } else {
    bot.sendMessage(msg.chat.id, "⚠️ خطا در دریافت قیمت لحظه‌ای.");
  }
});

// =====================
// زمان‌بندی Loopها
// =====================
setInterval(checkPrice, CHECK_PRICE_INTERVAL);
setInterval(checkNews, CHECK_NEWS_INTERVAL);

// =====================
// وب سرور برای Render Health Check
// =====================
app.get("/", (req, res) => {
  res.status(200).send("Bot is alive and running!");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
