const ccxt = require('ccxt')
const BitoPro = require('bitopro-api-node')
const BigNumber = require('bignumber.js')
const endOfLine = require('os').EOL
const setting = require('./setting')

let vendorName = setting.vendorName
const vendorID = vendorName
vendorName = `${vendorName[0].toUpperCase()}${vendorName.slice(1)}`
let vendorPair = setting.vendorPair
let bitoproPair = setting.bitoproPair

const updateVendorOrderbookInterval = 1000
const updateBitoProOrderbookInterval = 1000
const checkProfitInterval = 500

let vendorSymbolArr = vendorPair.split('/')
let vendorSellSymbol = vendorSymbolArr[0].toUpperCase()
let vendorBuySymbol = vendorSymbolArr[1].toUpperCase()
let vendorPricePrecision = 0
let vendorAmountPrecision = 0

let bitoproSymbolArr = bitoproPair.split('_')
let bitoproSellSymbol = bitoproSymbolArr[0].toUpperCase()
let bitoproBuySymbol = bitoproSymbolArr[1].toUpperCase()

let openOrderProfitPercentThreshold = setting.openOrderProfitPercentThreshold
let maxValuePerArbitrage = setting.maxValuePerArbitrage

let vendor = new ccxt[vendorID]({
  apiKey: setting.vendorAPIKey,
  secret: setting.vendorAPISecret
})

const bitopro = new BitoPro(setting.bitoproAPIKey, setting.bitoproAPISecret, setting.bitoproEmail)
let vendorOrderbook = []
let bitoproOrderbook = []

let vendorStatus = false
let bitoproStatus = false

let inARound = false

let updateVendorOrderbook = async () => {
  try {
    vendorOrderbook = await vendor.fetchOrderBook(vendorPair)
    vendorStatus = true
  } catch (e) {
    vendorStatus = false
    console.log(e)
  }
}

let startUpdateVendorOrderbook = async () => {
  await updateVendorOrderbook()
  setInterval(async () => {
    try {
      await updateVendorOrderbook()
    } catch (e) {
      console.log(e)
    }
  }, updateVendorOrderbookInterval)
}

let updateBitoOrderbook = async () => {
  try {
    bitoproOrderbook = await bitopro.getOrderBook(bitoproPair)
    bitoproStatus = true
  } catch (e) {
    bitoproStatus = false
    console.log(e)
  }
}

let startUpdateBitoOrderbook = async () => {
  await updateBitoOrderbook()
  setInterval(async () => {
    try {
      await updateBitoOrderbook()
    } catch (e) {
      console.log(e)
    }
  }, updateBitoProOrderbookInterval)
}

let checkBuyFromBitoSellToVendorWithAmount = async (targetAmount, vendorLevel, bitoproLevel, result) => {
  let totalBitoValue = new BigNumber(0)
  let tempBitoAmount = new BigNumber(0)
  let averageBitoAskPrice = new BigNumber(0)
  let lastBitoAskPrice = 0

  for (let i = 0; (i < bitoproLevel) && (i < bitoproOrderbook.asks.length); i++) {
    let ask = bitoproOrderbook.asks[i]
    let askPrice = ask.price
    let askAmount = ask.amount
    lastBitoAskPrice = askPrice
    tempBitoAmount = tempBitoAmount.plus(askAmount)
    if (tempBitoAmount.isGreaterThan(targetAmount)) {
      let diffAmount = targetAmount.minus((tempBitoAmount.minus(askAmount)))
      totalBitoValue = totalBitoValue.plus((new BigNumber(askPrice).multipliedBy(diffAmount)))
      break
    } else {
      totalBitoValue = totalBitoValue.plus((new BigNumber(askPrice).multipliedBy(askAmount)))
    }
  }

  averageBitoAskPrice = totalBitoValue.dividedBy(targetAmount)


  result += `BitoPro目標買單量: ${targetAmount} ${bitoproSellSymbol}` + endOfLine
  result += `BitoPro目標買單均價: ${averageBitoAskPrice.toString()} ${bitoproPair}` + endOfLine
  result += `BitoPro賣盤最後一檔價位: ${lastBitoAskPrice} ${bitoproPair}` + endOfLine

  let totalVendorValue = new BigNumber(0)
  let tempVendorAmount = new BigNumber(0)
  let averageVendorBidPrice = new BigNumber(0)
  let lastVendorBidPrice = 0

  for (let i = 0; (i < vendorLevel) && (i < vendorOrderbook.bids.length); i++) {
    let bid = vendorOrderbook.bids[i]
    let bidPrice = bid[0]
    let bidAmount = bid[1]
    lastVendorBidPrice = bidPrice
    tempVendorAmount = tempVendorAmount.plus(bidAmount)
    if (tempVendorAmount.isGreaterThan(targetAmount)) {
      let diffAmount = targetAmount.minus((tempVendorAmount.minus(bidAmount)))
      totalVendorValue = totalVendorValue.plus(new BigNumber(bidPrice).multipliedBy(diffAmount))
      break
    } else {
      totalVendorValue = totalVendorValue.plus(new BigNumber(bidPrice).multipliedBy(bidAmount))
    }
  }

  averageVendorBidPrice = totalVendorValue.dividedBy(targetAmount)


  result += `${vendorName}目標賣單量: ${targetAmount} ${vendorSellSymbol}` + endOfLine
  result += `${vendorName}目標賣單均價: ${averageVendorBidPrice.toString()} ${vendorPair}` + endOfLine
  result += `${vendorName}買盤最後一檔價位: ${lastVendorBidPrice} ${vendorPair}` + endOfLine
  result += `預期Profit必須超過門檻才下單: ${openOrderProfitPercentThreshold}%` + endOfLine
  let profitTotalValue = averageVendorBidPrice.minus(averageBitoAskPrice).multipliedBy(targetAmount)
  let profit = profitTotalValue.dividedBy(totalBitoValue).multipliedBy(100)
  result += `Profit: ${profit.toString()} %` + endOfLine

  if (averageBitoAskPrice.isLessThan(averageVendorBidPrice)) {
    let vendorBalances = await vendor.fetchBalance()
    let vendorFreeSellBalance = vendorBalances[vendorSellSymbol].free

    let bitoproBalances = await bitopro.getAccountBalances()
    bitoproBalances = bitoproBalances.data
    let bitoproFreeBuyBalance = 0
    bitoproBalances.forEach(balance => {
      if (balance.currency.toUpperCase() === bitoproBuySymbol) {
        bitoproFreeBuyBalance = balance.available
      }
    })

    result += '-----------------------餘額檢查----------------------------' + endOfLine
    result += `vendorFreeSellBalance: ${vendorFreeSellBalance} ${vendorSellSymbol}` + endOfLine
    result += `vendorFreeSellBalance需要大於 ${targetAmount} ${vendorSellSymbol}` + endOfLine
    result += `bitoproFreeBuyBalance: ${bitoproFreeBuyBalance} ${bitoproBuySymbol}` + endOfLine
    result += `bitoproFreeBuyBalance需要大於: ${totalBitoValue} ${bitoproBuySymbol}` + endOfLine
    result += '----------------------------------------------------------' + endOfLine

    if (profit.isGreaterThanOrEqualTo(openOrderProfitPercentThreshold) && lastVendorBidPrice && lastBitoAskPrice > 0) {
      if (new BigNumber(vendorFreeSellBalance).isGreaterThanOrEqualTo(targetAmount)
        && new BigNumber(bitoproFreeBuyBalance).isGreaterThanOrEqualTo(totalBitoValue)) {
        targetAmount = targetAmount.toString()
        let vendorOrder = {
          pair: vendorPair,
          amount: targetAmount,
          price: lastVendorBidPrice,
          action: 'sell',
          type: 'limit'
        }

        let bitoproOrder = {
          pair: bitoproPair,
          action: 'buy',
          amount: targetAmount,
          price: lastBitoAskPrice,
          timestamp: Date.now(),
          type: 'limit'
        }

        result += '-----------------------下單參數----------------------------' + endOfLine
        result += `BitoPro pair: ${bitoproPair}` + endOfLine
        result += 'Buy from BitoPro:' + endOfLine
        result += JSON.stringify(bitoproOrder) + endOfLine
        result += `${vendorName} pair: ${vendorPair}` + endOfLine
        result += `Sell to ${vendorName}:` + endOfLine
        result += JSON.stringify(vendorOrder) + endOfLine
        result += `預期Profit: ${profit.toString()} %` + endOfLine
        result += '----------------------------------------------------------' + endOfLine

        try {
          let vendorOrderResult = await vendor.createLimitSellOrder(vendorPair, vendorOrder.amount, vendorOrder.price)
          let bitoproOrderResult = await bitopro.createOrder(bitoproOrder)

          result += JSON.stringify(vendorOrderResult) + endOfLine
          result += JSON.stringify(bitoproOrderResult) + endOfLine

          let vendorOrderID = vendorOrderResult.id
          let bitoproOrderID = bitoproOrderResult.orderId

          let vendorOrderStatus = await vendor.fetchOrder(vendorOrderID, vendorPair)
          let bitoproOrderStatus = await bitopro.getOrder(bitoproPair, bitoproOrderID)

          result += '-----------------------下單結果----------------------------' + endOfLine
          result += JSON.stringify(vendorOrderStatus) + endOfLine
          result += JSON.stringify(bitoproOrderStatus) + endOfLine
          result += '----------------------------------------------------------' + endOfLine
          printResult(result)
        } catch (e) {
          printResult(result)
          console.log(e)
        }
      } else {
        result += '-----------------------結果-------------------------------' + endOfLine
        result += '餘額不足不下單' + endOfLine
        result += '----------------------------------------------------------' + endOfLine
        printResult(result)
      }
    } else {
      result += '-----------------------結果-------------------------------' + endOfLine
      result += 'Profit未超過設定門檻不下單' + endOfLine
      result += '----------------------------------------------------------' + endOfLine
      printResult(result)
    }
  } else {
    result += '-----------------------結果-------------------------------' + endOfLine
    result += `Buy from BitoPro sell to ${vendorName} 無套利空間不下單` + endOfLine
    result += '----------------------------------------------------------' + endOfLine
    printResult(result)
  }
}

let intentToBuyFromBitoSellToVendor = async () => {
  try {
    let result = ''
    result += `----------------開始從BitoPro買${vendorName}賣-------------------` + endOfLine
    let bitoproLevel = 0
    let totalValue = new BigNumber(0)
    let bitoproAmount = new BigNumber(0)
    let maxValuePerArbitrageBN = new BigNumber(maxValuePerArbitrage)

    for (let i = 0; i < bitoproOrderbook.asks.length; i++) {
      let ask = bitoproOrderbook.asks[i]
      let askPrice = ask.price
      let askAmount = ask.amount
      bitoproAmount = bitoproAmount.plus(askAmount)
      totalValue = totalValue.plus((new BigNumber(askPrice).multipliedBy(askAmount)))
      bitoproLevel++
      if (totalValue.isGreaterThan(maxValuePerArbitrageBN)) {
        bitoproAmount = bitoproAmount.minus(askAmount)
        totalValue = totalValue.minus((new BigNumber(askPrice).multipliedBy(askAmount)))

        maxValuePerArbitrageBN = maxValuePerArbitrageBN.minus(totalValue)
        let lastAmount = maxValuePerArbitrageBN.dividedBy(askPrice)
        bitoproAmount = bitoproAmount.plus(lastAmount)
        totalValue = totalValue.plus((new BigNumber(askPrice).multipliedBy(lastAmount)))
        break
      }
    }

    result += `不超過目標BitoPro買單總值 ${maxValuePerArbitrage} ${bitoproBuySymbol}，前 ${bitoproLevel} 檔，深度價值總值 ${totalValue.toString()} ${bitoproBuySymbol}` + endOfLine
    result += `目標BitoPro買單量 ${bitoproAmount} ${bitoproSellSymbol}` + endOfLine

    let vendorLevel = 0
    totalValue = new BigNumber(0)
    let vendorAmount = new BigNumber(0)
    maxValuePerArbitrageBN = new BigNumber(maxValuePerArbitrage)

    for (let i = 0; i < vendorOrderbook.bids.length; i++) {
      let bid = vendorOrderbook.bids[i]
      let bidPrice = bid[0]
      let bidAmount = bid[1]
      vendorAmount = vendorAmount.plus(bidAmount)
      totalValue = totalValue.plus((new BigNumber(bidPrice).multipliedBy(bidAmount)))
      vendorLevel++
      if (totalValue.isGreaterThan(maxValuePerArbitrageBN)) {
        vendorAmount = vendorAmount.minus(bidAmount)
        totalValue = totalValue.minus((new BigNumber(bidPrice).multipliedBy(bidAmount)))

        maxValuePerArbitrageBN = maxValuePerArbitrageBN.minus(totalValue)
        let lastAmount = maxValuePerArbitrageBN.dividedBy(bidPrice)
        vendorAmount = vendorAmount.plus(lastAmount)
        totalValue = totalValue.plus((new BigNumber(bidPrice).multipliedBy(lastAmount)))
        break
      }
    }

    result += `不超過目標${vendorName}賣單總值 ${maxValuePerArbitrage} ${vendorBuySymbol}，前 ${vendorLevel} 檔，深度價值總值 ${totalValue.toString()} ${vendorBuySymbol}` + endOfLine
    result += `目標${vendorName}賣單量 ${vendorAmount} ${vendorSellSymbol}` + endOfLine

    let targetAmount = (bitoproAmount.isGreaterThan(vendorAmount)) ? vendorAmount : bitoproAmount
    targetAmount = new BigNumber(targetAmount.toFixed(vendorAmountPrecision))

    await checkBuyFromBitoSellToVendorWithAmount(targetAmount, vendorLevel, bitoproLevel, result)
  } catch (e) {
    console.log(e)
  }
}

let checkBuyFromVendorSellToBitoWithAmount = async (targetAmount, vendorLevel, bitoproLevel, result) => {
  let totalVendorValue = new BigNumber(0)
  let tempVendorAmount = new BigNumber(0)
  let averageVendorAskPrice = new BigNumber(0)
  let lastVendorAskPrice = 0

  for (let i = 0; (i < vendorLevel) && (i < vendorOrderbook.asks.length); i++) {
    let ask = vendorOrderbook.asks[i]
    let askPrice = ask[0]
    let askAmount = ask[1]
    lastVendorAskPrice = askPrice
    tempVendorAmount = tempVendorAmount.plus(askAmount)
    if (tempVendorAmount.isGreaterThan(targetAmount)) {
      let diffAmount = targetAmount.minus((tempVendorAmount.minus(askAmount)))
      totalVendorValue = totalVendorValue.plus(new BigNumber(askPrice).multipliedBy(diffAmount))
      break
    } else {
      totalVendorValue = totalVendorValue.plus(new BigNumber(askPrice).multipliedBy(askAmount))
    }
  }

  averageVendorAskPrice = totalVendorValue.dividedBy(targetAmount)

  result += `${vendorName}目標買單量: ${targetAmount} ${vendorSellSymbol}` + endOfLine
  result += `${vendorName}目標買單均價: ${averageVendorAskPrice.toString()} ${vendorPair}` + endOfLine
  result += `${vendorName}賣盤最後一檔價位: ${lastVendorAskPrice} ${vendorPair}` + endOfLine

  let totalBitoValue = new BigNumber(0)
  let tempBitoAmount = new BigNumber(0)
  let averageBitoBidPrice = new BigNumber(0)
  let lastBitoBidPrice = 0

  for (let i = 0; (i < bitoproLevel) && (i < bitoproOrderbook.bids.length); i++) {
    let bid = bitoproOrderbook.bids[i]
    let bidPrice = bid.price
    let bidAmount = bid.amount
    lastBitoBidPrice = bidPrice
    tempBitoAmount = tempBitoAmount.plus(bidAmount)
    if (tempBitoAmount.isGreaterThan(targetAmount)) {
      let diffAmount = targetAmount.minus((tempBitoAmount.minus(bidAmount)))
      totalBitoValue = totalBitoValue.plus((new BigNumber(bidPrice).multipliedBy(diffAmount)))
      break
    } else {
      totalBitoValue = totalBitoValue.plus((new BigNumber(bidPrice).multipliedBy(bidAmount)))
    }
  }

  averageBitoBidPrice = totalBitoValue.dividedBy(targetAmount)

  result += `BitoPro目標賣單量: ${targetAmount} ${bitoproSellSymbol}` + endOfLine
  result += `BitoPro目標賣單均價: ${averageBitoBidPrice.toString()} ${bitoproPair}` + endOfLine
  result += `BitoPro買盤最後一檔價位: ${lastBitoBidPrice} ${bitoproPair}` + endOfLine
  result += `預期Profit必須超過門檻才下單: ${openOrderProfitPercentThreshold}%` + endOfLine
  let profitTotalValue = (averageBitoBidPrice.minus(averageVendorAskPrice)).multipliedBy(targetAmount)
  let profit = profitTotalValue.dividedBy(totalVendorValue).multipliedBy(100)
  result += `Profit: ${profit.toString()} %` + endOfLine

  if (averageVendorAskPrice.isLessThan(averageBitoBidPrice)) {
    let vendorBalances = await vendor.fetchBalance()
    let vendorFreeBuyBalance = vendorBalances[vendorBuySymbol].free

    let bitoproBalances = await bitopro.getAccountBalances()
    bitoproBalances = bitoproBalances.data
    let bitoproFreeSellBalance = 0
    bitoproBalances.forEach(balance => {
      if (balance.currency.toUpperCase() === bitoproSellSymbol) {
        bitoproFreeSellBalance = balance.available
      }
    })

    result += '-----------------------餘額檢查----------------------------' + endOfLine
    result += `vendorFreeBuyBalance: ${vendorFreeBuyBalance} ${vendorBuySymbol}` + endOfLine
    result += `vendorFreeBuyBalance需要大於 ${totalVendorValue} ${vendorBuySymbol}` + endOfLine
    result += `bitoproFreeSellBalance: ${bitoproFreeSellBalance} ${bitoproSellSymbol}` + endOfLine
    result += `bitoproFreeSellBalance需要大於: ${targetAmount} ${bitoproSellSymbol}` + endOfLine
    result += '----------------------------------------------------------' + endOfLine

    if (profit.isGreaterThanOrEqualTo(openOrderProfitPercentThreshold) && lastVendorAskPrice && lastBitoBidPrice > 0) {
      if (new BigNumber(vendorFreeBuyBalance).isGreaterThanOrEqualTo(totalVendorValue)
        && new BigNumber(bitoproFreeSellBalance).isGreaterThanOrEqualTo(targetAmount)) {
        targetAmount = targetAmount.toString()
        let vendorOrder = {
          pair: vendorPair,
          amount: targetAmount,
          price: lastVendorAskPrice,
          action: 'buy',
          type: 'limit'
        }

        let bitoproOrder = {
          pair: bitoproPair,
          action: 'sell',
          amount: targetAmount,
          price: lastBitoBidPrice,
          timestamp: Date.now(),
          type: 'limit'
        }

        result += '-----------------------下單參數----------------------------' + endOfLine
        result += `${vendorName} pair: ${vendorPair}` + endOfLine
        result += `Buy from ${vendorName}:` + endOfLine
        result += JSON.stringify(vendorOrder) + endOfLine
        result += `BitoPro pair: ${bitoproPair}` + endOfLine
        result += 'Sell to BitoPro:' + endOfLine
        result += JSON.stringify(bitoproOrder) + endOfLine
        result += `預期Profit: ${profit.toString()} %` + endOfLine
        result += '----------------------------------------------------------' + endOfLine

        try {
          let vendorOrderResult = await vendor.createLimitBuyOrder(vendorPair, vendorOrder.amount, vendorOrder.price)
          let bitoproOrderResult = await bitopro.createOrder(bitoproOrder)

          result += JSON.stringify(vendorOrderResult) + endOfLine
          result += JSON.stringify(bitoproOrderResult) + endOfLine

          let vendorOrderID = vendorOrderResult.id
          let bitoproOrderID = bitoproOrderResult.orderId

          let vendorOrderStatus = await vendor.fetchOrder(vendorOrderID, vendorPair)
          let bitoproOrderStatus = await bitopro.getOrder(bitoproPair, bitoproOrderID)

          result += '-----------------------下單結果----------------------------' + endOfLine
          result += JSON.stringify(vendorOrderStatus) + endOfLine
          result += JSON.stringify(bitoproOrderStatus) + endOfLine
          result += '----------------------------------------------------------' + endOfLine
          printResult(result)
        } catch (e) {
          printResult(result)
          console.log(e)
        }
      } else {
        result += '-----------------------結果-------------------------------' + endOfLine
        result += '餘額不足不下單' + endOfLine
        result += '----------------------------------------------------------' + endOfLine
        printResult(result)
      }
    } else {
      result += '-----------------------結果-------------------------------' + endOfLine
      result += 'Profit未超過設定門檻不下單' + endOfLine
      result += '----------------------------------------------------------' + endOfLine
      printResult(result)
    }
  } else {
    result += '-----------------------結果-------------------------------' + endOfLine
    result += `Buy from ${vendorName} sell to BitoPro 無套利空間不下單` + endOfLine
    result += '----------------------------------------------------------' + endOfLine
    printResult(result)
  }
}

let intentToBuyFromVendorSellToBito = async () => {
  try {
    let result = ''
    result += `----------------開始從${vendorName}買BitoPro賣-------------------` + endOfLine
    let vendorLevel = 0
    let totalValue = new BigNumber(0)
    let vendorAmount = new BigNumber(0)
    let maxValuePerArbitrageBN = new BigNumber(maxValuePerArbitrage)

    for (let i = 0; i < vendorOrderbook.asks.length; i++) {
      let ask = vendorOrderbook.asks[i]
      let askPrice = ask[0]
      let askAmount = ask[1]
      vendorAmount = vendorAmount.plus(askAmount)
      totalValue = totalValue.plus((new BigNumber(askPrice).multipliedBy(askAmount)))
      vendorLevel++
      if (totalValue.isGreaterThan(maxValuePerArbitrageBN)) {
        vendorAmount = vendorAmount.minus(askAmount)
        totalValue = totalValue.minus((new BigNumber(askPrice).multipliedBy(askAmount)))

        maxValuePerArbitrageBN = maxValuePerArbitrageBN.minus(totalValue)
        let lastAmount = maxValuePerArbitrageBN.dividedBy(askPrice)
        vendorAmount = vendorAmount.plus(lastAmount)
        totalValue = totalValue.plus((new BigNumber(askPrice).multipliedBy(lastAmount)))
        break
      }
    }

    result += `不超過目標${vendorName}買單總值 ${maxValuePerArbitrage} ${vendorBuySymbol}，前 ${vendorLevel} 檔，深度價值總值 ${totalValue.toString()} ${vendorBuySymbol}` + endOfLine
    result += `目標${vendorName}買單量 ${vendorAmount} ${vendorSellSymbol}` + endOfLine

    let bitoproLevel = 0
    totalValue = new BigNumber(0)
    let bitoproAmount = new BigNumber(0)
    maxValuePerArbitrageBN = new BigNumber(maxValuePerArbitrage)

    for (let i = 0; i < bitoproOrderbook.bids.length; i++) {
      let bid = bitoproOrderbook.bids[i]
      let bidPrice = bid.price
      let bidAmount = bid.amount
      bitoproAmount = bitoproAmount.plus(bidAmount)
      totalValue = totalValue.plus((new BigNumber(bidPrice).multipliedBy(bidAmount)))
      bitoproLevel++
      if (totalValue.isGreaterThan(maxValuePerArbitrageBN)) {
        bitoproAmount = bitoproAmount.minus(bidAmount)
        totalValue = totalValue.minus((new BigNumber(bidPrice).multipliedBy(bidAmount)))

        maxValuePerArbitrageBN = maxValuePerArbitrageBN.minus(totalValue)
        let lastAmount = maxValuePerArbitrageBN.dividedBy(bidPrice)
        bitoproAmount = bitoproAmount.plus(lastAmount)
        totalValue = totalValue.plus((new BigNumber(bidPrice).multipliedBy(lastAmount)))
        break
      }
    }

    result += `不超過目標BitoPro賣單總值 ${maxValuePerArbitrage} ${bitoproBuySymbol}，前 ${bitoproLevel} 檔，深度價值總值 ${totalValue.toString()} ${bitoproBuySymbol}` + endOfLine
    result += `目標BitoPro賣單量 ${bitoproAmount} ${bitoproSellSymbol}` + endOfLine

    let targetAmount = (bitoproAmount.isGreaterThan(vendorAmount)) ? vendorAmount : bitoproAmount
    targetAmount = new BigNumber(targetAmount.toFixed(vendorAmountPrecision))

    await checkBuyFromVendorSellToBitoWithAmount(targetAmount, vendorLevel, bitoproLevel, result)
  } catch (e) {
    console.log(e)
  }
}

let detectAndOpenOrders = async () => {
  try {
    if (vendorStatus && bitoproStatus) {
      return Promise.all([intentToBuyFromBitoSellToVendor(), intentToBuyFromVendorSellToBito()])
    }
  } catch (e) {
    console.log(e)
  }
}

let printResult = (result) => {
  console.log(result)
}

let main = async () => {
  await vendor.loadMarkets()
  let market = vendor.markets[vendorPair]
  let precision = market.precision
  vendorPricePrecision = precision.price
  vendorAmountPrecision = precision.amount

  if (vendorPricePrecision > 0 && vendorAmountPrecision > 0) {
    inARound = true
    try {
      await detectAndOpenOrders()
    } catch (e) {
      console.log(e)
    }
    inARound = false
  
    setInterval(async () => {
      if (!inARound) {
        inARound = true
        try {
          await detectAndOpenOrders()
        } catch (e) {
          console.log(e)
        }
        inARound = false
      }
    }, checkProfitInterval)
  }
}

startUpdateVendorOrderbook()
startUpdateBitoOrderbook()
main()
