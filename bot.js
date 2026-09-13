const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const express = require("express");

const app = express();

const TOKEN = process.env.BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

let CHAT_ID = null;

let priceAlerts = [2350, 2365, 2330];
let triggered = {};

async function getGoldPrice() {
  try {
    const res = await axios.get("https://api.metals.live/v1/spot");
    return res.data[0].gold;
  } catch {
    return null;
  }
}

async function checkPrice() {
  const price = await getGoldPrice();
  if (!price || !CHAT_ID) return;

  priceAlerts.forEach(level => {
    if (price >= level && !triggered[level]) {
      bot.sendMessage(CHAT_ID, `🚨 ${price} رسید به ${level}`);
      triggered[level] = true;
    }
    if (price < level) triggered[level] = false;
  });
}

bot.onText(/\/start/, msg => {
  CHAT_ID = msg.chat.id;
  bot.sendMessage(CHAT_ID, "✅ فعال شد");
});

setInterval(checkPrice, 10000);

app.get("/", (req, res) => res.send("alive"));
app.listen(3000);