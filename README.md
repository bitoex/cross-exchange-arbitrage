# Cross Exchange Arbitrage

This project could help you do arbitrage trading between BitoPro and other mainstream cryptocurrency exchanges.

## Prerequisites

1. Node.js above version 8.
2. BitoPro account and the trading API key relative to the account.
3. Other mainsteam account and the trading API key relative to the account, for example: Binance, okex.

## Install

Install dependencies with `npm`

```javascript
npm install
```

## Setup

Edit `setting.json` file before launch the robot.

```javascript
{
  "vendorName": "binance",
  "vendorAPIKey": "",
  "vendorAPISecret": "",
  "bitoAPIKey": "",
  "bitoAPISecret": "",
  "bitoEmail": "",
  "bitoPair": "btc_usdt",
  "vendorPair": "BTC/USDT",
  "openOrderProfitPercentThreshold": 0.5,
  "maxValuePerArbitrage": 50
}
```

* `vendorName`: We use [ccxt](https://github.com/ccxt/ccxt) to develop the project so that you can choose the exchange that ccxt support to trade between BitoPro and the vendor exchange.
* `vendorAPIKey`: The API key that can trade on your vendor exchange.
* `vendorAPISecret`: The API secret that can trade on your vendor exchange.
* `bitoAPIKey`: The API key that can trade on BitoPro.
* `bitoAPISecret`: The API secret that can trade on BitoPro.
* `bitoEmail`: The email account which is used to geneate the `bitoAPIKey`.
* `bitoPair`: The trading pair is listed on BitoPro. For example: btc_usdt, eth_usdt or btc_eth.
* `vendorPair`: The trading pair is listed on the vendor exchange. It follows the [ccxt rules](https://github.com/ccxt/ccxt/wiki/Manual#symbols-and-market-ids).
* `openOrderProfitPercentThreshold`: The target threshold in percentage to open orders. For example: If we set the `openOrderProfitPercentThreshold` to 0.5, the robot will open orders if and only if the arbitrage profit is over 0.5%.
* `maxValuePerArbitrage`: The total value for each order. For example: When the target pair is `BTC/USDT` and the `maxValuePerArbitrage` is set to 1000 means the program will open orders with amount in `BTC` unit that is approximately worth 1000 USDT for each order.

## Running the robot

```javascript
node index.js
// or
npm start
```

That's it. Hope the project will make you rich!