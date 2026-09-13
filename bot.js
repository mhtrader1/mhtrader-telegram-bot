// bot.js
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const express = require("express");
const app = express();

const TOKEN = "8073311085:AAGjCPmGVXSTWdnGXoWrgzIloV5jMhTZ7j4";
const bot = new TelegramBot(TOKEN, { polling: true });

let CHAT_ID = null;

// =====================
// تنظیمات
// =====================
let priceAlerts = [2350, 2365, 2330]; // محدوده‌ها
let triggered = {};

const CHECK_INTERVAL = 10000; // 10s

// =====================
// گرفتن قیمت طلا
// =====================
async function getGoldPrice() {
  try {
    const res = await axios.get("https://api.metals.live/v1/spot");
    return res.data[0].gold;
  } catch (e) {
    return null;
  }
}

// =====================
// چک قیمت
// =====================
async function checkPrice() {
  const price = await getGoldPrice();
  if (!price || !CHAT_ID) return;

  priceAlerts.forEach(level => {
    if (price >= level && !triggered[level]) {
      bot.sendMessage(CHAT_ID, `🚨 رسید به سطح ${level} | قیمت: ${price}`);
      triggered[level] = true;
    }
    if (price < level) {
      triggered[level] = false;
    }
  });
}

// =====================
// گرفتن خبرهای ForexFactory
// =====================
async function getForexNews() {
  try {
    const { data } = await axios.get("https://www.forexfactory.com/calendar");
    const $ = cheerio.load(data);

    let news = [];

    $(".calendar__row").each((i, el) => {
      const impact = $(el).find(".impact").attr("title");
      const time = $(el).find(".calendar__time").text().trim();
      const title = $(el).find(".calendar__event-title").text().trim();

      if (impact && impact.includes("High")) {
        news.push({ time, title });
      }
    });

    return news;
  } catch (e) {
    return [];
  }
}

// =====================
// چک خبر
// =====================
let lastNewsSent = "";

async function checkNews() {
  if (!CHAT_ID) return;

  const news = await getForexNews();

  if (news.length > 0) {
    const msg = news.slice(0, 3)
      .map(n => `🔴 ${n.time} - ${n.title}`)
      .join("\n");

    if (msg !== lastNewsSent) {
      bot.sendMessage(CHAT_ID, `📅 اخبار مهم:\n${msg}`);
      lastNewsSent = msg;
    }
  }
}

// =====================
// دستورات تلگرام
// =====================
bot.onText(/\/start/, msg => {
  CHAT_ID = msg.chat.id;
  bot.sendMessage(CHAT_ID, "ربات فعال شد ✅");
});

bot.onText(/\/add (.+)/, (msg, match) => {
  const price = parseFloat(match[1]);
  if (!isNaN(price)) {
    priceAlerts.push(price);
    bot.sendMessage(msg.chat.id, `✅ اضافه شد: ${price}`);
  }
});

bot.onText(/\/list/, msg => {
  bot.sendMessage(msg.chat.id, `📊 سطوح:\n${priceAlerts.join("\n")}`);
});

// =====================
// لوپ‌ها
// =====================
setInterval(checkPrice, CHECK_INTERVAL);
setInterval(checkNews, 60000); // هر 1 دقیقه

app.get("/", (req, res) => res.send("Bot is alive"));
app.listen(3000);