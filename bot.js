// bot.js
const TelegramBot = require("node-telegram-bot-api").default;
const axios = require("axios");
const cheerio = require("cheerio");
const express = require("express");

const app = express();

const TOKEN = process.env.BOT_TOKEN; // 🔒 مهم
const bot = new TelegramBot(TOKEN, { polling: true });

let CHAT_ID = null;

let priceAlerts = [2350, 2365, 2330];
let triggered = {};

const CHECK_INTERVAL = 10000;

// =====================
// قیمت طلا
// =====================
async function getGoldPrice() {
  try {
    const res = await axios.get("https://api.metals.live/v1/spot");
    return res.data[0].gold;
  } catch {
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
      bot.sendMessage(CHAT_ID, `🚨 رسید به ${level} | ${price}`);
      triggered[level] = true;
    }
    if (price < level) triggered[level] = false;
  });
}

// =====================
// خبر ForexFactory
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
  } catch {
    return [];
  }
}

let lastNewsSent = "";

// =====================
// چک خبر
// =====================
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
// دستورات
// =====================
bot.onText(/\/start/, msg => {
  CHAT_ID = msg.chat.id;
  bot.sendMessage(CHAT_ID, "✅ فعال شد");
});

bot.onText(/\/add (.+)/, (msg, match) => {
  const price = parseFloat(match[1]);
  if (!isNaN(price)) {
    priceAlerts.push(price);
    bot.sendMessage(msg.chat.id, `✅ اضافه شد ${price}`);
  }
});

bot.onText(/\/list/, msg => {
  bot.sendMessage(msg.chat.id, priceAlerts.join("\n"));
});

// =====================
// loops
// =====================
setInterval(checkPrice, CHECK_INTERVAL);
setInterval(checkNews, 60000);

// =====================
// keep alive (Render)
// =====================
app.get("/", (req, res) => res.send("alive"));
app.listen(3000);