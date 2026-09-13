// bot.js
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import * as cheerio from "cheerio";
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error("❌ متغیر BOT_TOKEN در محیط Render تنظیم نشده است!");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

let CHAT_ID = null;
let priceAlerts = [2700, 2650, 2600]; // سطوح پیش‌فرض
let triggered = {};
const notifiedEvents = new Set();

const CHECK_PRICE_INTERVAL = 15000; // هر ۱۵ ثانیه
const CHECK_NEWS_INTERVAL = 60000;  // هر ۱ دقیقه

// کیبورد دکمه‌های شیشه‌ای بات
function getMainKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🟡 استعلام قیمت طلا (انس)", callback_data: "cmd_gold" },
          { text: "📰 تقویم و اخبار مهم امروز", callback_data: "cmd_news" }
        ],
        [
          { text: "📋 لیست هشدارهای فعال", callback_data: "cmd_list" },
          { text: "ℹ️ راهنمای دستورات", callback_data: "cmd_help" }
        ]
      ]
    }
  };
}

// =====================
// دریافت مطمئن قیمت طلا (با Fallback دوگانه)
// =====================
async function getGoldPrice() {
  // منبع ۱: gold-api.com (رایگان، بدون API Key و بسیار سریع)
  try {
    const res = await axios.get("https://api.gold-api.com/price/XAU", {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 7000
    });
    if (res.data && res.data.price) {
      return parseFloat(res.data.price);
    }
  } catch (err1) {
    console.warn("Gold-API failed, trying fallback...", err1.message);
  }

  // منبع ۲ (Fallback): دیتاسورس goldprice.org
  try {
    const res = await axios.get("https://data-asg.goldprice.org/dbXRates/USD", {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 7000
    });
    if (res.data?.items?.[0]?.xauPrice) {
      return parseFloat(res.data.items[0].xauPrice);
    }
  } catch (err2) {
    console.error("All gold price sources failed:", err2.message);
  }

  return null;
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
      bot.sendMessage(
        CHAT_ID,
        `🚨 *هشدار رسیدن به تارگت قیمتی!*\n\nنرخ انس طلا از سطح تعیین‌شده عبور کرد:\n💰 قیمت فعلی: **${price.toFixed(2)} $**\n🎯 سطح هشدار: **${level} $**`,
        { parse_mode: "Markdown" }
      );
      triggered[level] = true;
    }

    // اگر قیمت بیش از ۱.۵ دلار از سطح فاصله گرفت، هشدار دوباره آماده شلیک می‌شود
    if (price < level - 1.5) {
      triggered[level] = false;
    }
  });
}

// =====================
// استخراج اخبار پرتاثیر ForexFactory
// =====================
async function getForexNews() {
  try {
    const { data } = await axios.get("https://www.forexfactory.com/calendar", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    const news = [];

    $("tr.calendar__row").each((_, el) => {
      const impactSpan = $(el).find("td.calendar__impact span");
      const impactClass = impactSpan.attr("class") || "";
      const impactTitle = impactSpan.attr("title") || "";

      // بررسی اخبار High Impact (قرمز)
      const isHighImpact =
        impactClass.includes("red") ||
        impactClass.includes("high") ||
        impactTitle.toLowerCase().includes("high");

      if (isHighImpact) {
        const time = $(el).find("td.calendar__time").text().trim();
        const currency = $(el).find("td.calendar__currency").text().trim();
        const title = $(el).find("span.calendar__event-title").text().trim();
        const forecast = $(el).find("td.calendar__forecast").text().trim();
        const previous = $(el).find("td.calendar__previous").text().trim();

        if (title) {
          news.push({
            time: time || "طول روز",
            currency: currency || "USD",
            title,
            forecast: forecast || "-",
            previous: previous || "-"
          });
        }
      }
    });

    return news;
  } catch (err) {
    console.error("ForexFactory scraping error:", err.message);
    return [];
  }
}

// =====================
// هشدار خودکار لحظه‌ای خبرها
// =====================
async function checkNews() {
  if (!CHAT_ID) return;

  const news = await getForexNews();
  if (news.length === 0) return;

  for (const item of news) {
    const eventKey = `${item.currency}-${item.title}-${item.time}`;
    if (!notifiedEvents.has(eventKey)) {
      notifiedEvents.add(eventKey);
      await bot.sendMessage(
        CHAT_ID,
        `🔴 *خبر مهم پیش‌رو (High Impact)*\n\n📌 عنوان: **${item.title}**\n💱 ارز: **${item.currency}**\n⏰ ساعت: **${item.time}**\n📊 پیش‌بینی: \`${item.forecast}\` | قبلی: \`${item.previous}\``,
        { parse_mode: "Markdown" }
      );
    }
  }
}

// =====================
// پیام مشترک ساخت متن اخبار
// =====================
async function sendNewsReport(targetChatId) {
  const news = await getForexNews();
  if (!news || news.length === 0) {
    return bot.sendMessage(
      targetChatId,
      "ℹ️ برای امروز رویداد قرمز (High Impact) در دسترس نیست یا اتصال با اختلال مواجه شد.",
      getMainKeyboard()
    );
  }

  let text = "📅 *رویدادهای با اهمیت بالا (High Impact) امروز:*\n\n";
  news.slice(0, 7).forEach((item, index) => {
    text += `${index + 1}. **[${item.currency}]** ${item.title}\n⏰ ساعت: ${item.time} | پیش‌بینی: ${item.forecast}\n\n`;
  });

  bot.sendMessage(targetChatId, text, {
    parse_mode: "Markdown",
    ...getMainKeyboard()
  });
}

// =====================
// دستورات پیام متنی تلگرام
// =====================
bot.onText(/\/start/, (msg) => {
  CHAT_ID = msg.chat.id;
  bot.sendMessage(
    CHAT_ID,
    `سلام! دستیار معاملاتی فعال شد 📊\nبرای استفاده سریع می‌توانید از دکمه‌های زیر استفاده کنید:`,
    getMainKeyboard()
  );
});

bot.onText(/\/gold/, async (msg) => {
  const price = await getGoldPrice();
  if (price) {
    bot.sendMessage(msg.chat.id, `🟡 قیمت لحظه‌ای انس جهانی طلا (XAU/USD):\n💰 **${price.toFixed(2)} $**`, {
      parse_mode: "Markdown",
      ...getMainKeyboard()
    });
  } else {
    bot.sendMessage(msg.chat.id, "⚠️ متاسفانه دریافت نرخ لحظه‌ای طلا با خطا مواجه شد.", getMainKeyboard());
  }
});

bot.onText(/\/news/, async (msg) => {
  CHAT_ID = msg.chat.id;
  await sendNewsReport(msg.chat.id);
});

bot.onText(/\/add (.+)/, (msg, match) => {
  CHAT_ID = msg.chat.id;
  const price = parseFloat(match[1]);
  if (!isNaN(price) && price > 0) {
    priceAlerts.push(price);
    priceAlerts.sort((a, b) => a - b);
    bot.sendMessage(msg.chat.id, `✅ سطح قیمتی **${price} $** اضافه شد.`, {
      parse_mode: "Markdown",
      ...getMainKeyboard()
    });
  } else {
    bot.sendMessage(msg.chat.id, "❌ لطفاً عدد معتبر بفرستید. مثلاً:\n`/add 2650`", { parse_mode: "Markdown" });
  }
});

bot.onText(/\/list/, (msg) => {
  CHAT_ID = msg.chat.id;
  if (priceAlerts.length === 0) {
    return bot.sendMessage(msg.chat.id, "هیچ هشداری تنظیم نشده است.", getMainKeyboard());
  }
  const list = priceAlerts.map((p, i) => `${i + 1}. **${p} $**`).join("\n");
  bot.sendMessage(msg.chat.id, `📋 *سطوح فعال هشدار:*\n\n${list}`, {
    parse_mode: "Markdown",
    ...getMainKeyboard()
  });
});

bot.onText(/\/clear/, (msg) => {
  CHAT_ID = msg.chat.id;
  priceAlerts = [];
  triggered = {};
  bot.sendMessage(msg.chat.id, "🧹 تمام هشدارهای قیمتی حذف شدند.", getMainKeyboard());
});

// =====================
// مدیریت کلیک روی دکمه‌های شیشه‌ای
// =====================
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  CHAT_ID = chatId;

  // بستن لودینگ دکمه در تلگرام
  bot.answerCallbackQuery(query.id).catch(() => { });

  switch (query.data) {
    case "cmd_gold": {
      const price = await getGoldPrice();
      if (price) {
        bot.sendMessage(chatId, `🟡 قیمت لحظه‌ای طلا (XAU/USD):\n💰 **${price.toFixed(2)} $**`, {
          parse_mode: "Markdown",
          ...getMainKeyboard()
        });
      } else {
        bot.sendMessage(chatId, "⚠️ دریافت قیمت با خطا مواجه شد. چند لحظه بعد تلاش کنید.", getMainKeyboard());
      }
      break;
    }

    case "cmd_news": {
      await sendNewsReport(chatId);
      break;
    }

    case "cmd_list": {
      if (priceAlerts.length === 0) {
        bot.sendMessage(chatId, "هیچ هشداری ذخیره نشده است.", getMainKeyboard());
      } else {
        const list = priceAlerts.map((p, i) => `${i + 1}. **${p} $**`).join("\n");
        bot.sendMessage(chatId, `📋 *سطوح فعال هشدار:*\n\n${list}`, {
          parse_mode: "Markdown",
          ...getMainKeyboard()
        });
      }
      break;
    }

    case "cmd_help": {
      bot.sendMessage(
        chatId,
        `📌 *راهنمای کار با دستیار:*\n\n` +
        `• برای ثبت هشدار جدید: \`/add 2700\`\n` +
        `• برای دیدن لیست سطوح: \`/list\`\n` +
        `• برای حذف تمام هشدارها: \`/clear\`\n` +
        `• برای دریافت دستی قیمت: \`/gold\`\n` +
        `• برای دریافت دستی اخبار: \`/news\``,
        { parse_mode: "Markdown", ...getMainKeyboard() }
      );
      break;
    }
  }
});

// =====================
// حلقه‌های پایش دوره‌ای
// =====================
setInterval(checkPrice, CHECK_PRICE_INTERVAL);
setInterval(checkNews, CHECK_NEWS_INTERVAL);

// =====================
// وب سرور برای Health Check در رندر
// =====================
app.get("/", (req, res) => {
  res.status(200).send("Trading bot is running smoothly!");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
