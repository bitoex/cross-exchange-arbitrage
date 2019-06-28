const ccxt = require('ccxt')
const BitoPro = require('bitopro-api-node')
const BigNumber = require('bignumber.js')
const setting = require('./setting')

let vendorName = setting.vendorName
let vendorPair = setting.vendorPair
let bitoPair = setting.bitoPair

let vendorSymbolArr = vendorPair.split('/')
let vendorSellSymbol = vendorSymbolArr[0].toUpperCase()
let vendorBuySymbol = vendorSymbolArr[1].toUpperCase()

let bitoSymbolArr = bitoPair.split('_')
let bitoSellSymbol = bitoSymbolArr[0].toUpperCase()
let bitoBuySymbol = bitoSymbolArr[1].toUpperCase()

let openOrderProfitPercentThreshold = setting.openOrderProfitPercentThreshold
let maxValuePerArbitrage = setting.maxValuePerArbitrage

let vendor = new ccxt[vendorName]({
  apiKey: setting.vendorAPIKey,
  secret: setting.vendorAPISecret
})

const bitopro = new BitoPro(setting.bitoAPIKey, setting.bitoAPISecret, setting.bitoEmail)
let vendorOrderbook = []
let bitoOrderbook = []

let vendorStatus = false
let bitoStatus = false

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
  }, 2000)
}

let updateBitoOrderbook = async () => {
  try {
    bitoOrderbook = await bitopro.getOrderBook(bitoPair)
    bitoStatus = true
  } catch (e) {
    bitoStatus = false
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
  }, 2000)
}

let checkBuyFromBitoSellToVendorWithAmount = async (targetAmount, vendorLevel, bitoLevel) => {
  let totalBitoValue = new BigNumber(0)
  let tempBitoAmount = new BigNumber(0)
  let averageBitoAskPrice = new BigNumber(0)
  let lastBitoAskPrice = 0

  for (let i = 0; (i < bitoLevel) && (i < bitoOrderbook.asks.length); i++) {
    let ask = bitoOrderbook.asks[i]
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

  console.log(`BitoPro目標買單量: ${targetAmount} ${bitoSellSymbol}`)
  console.log(`BitoPro目標買單均價: ${averageBitoAskPrice.toString()} ${bitoPair}`)
  console.log(`BitoPro賣盤最後一檔價位: ${lastBitoAskPrice} ${bitoPair}`)
  
  // 以targetAmount為主算均價，再來算profit，target amount單位如: btc_usdt，則為btc數量
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

  console.log(`${vendorName}目標賣單量: ${targetAmount} ${vendorSellSymbol}`)
  console.log(`${vendorName}目標賣單均價: ${averageVendorBidPrice.toString()} ${vendorPair}`)
  console.log(`${vendorName}買盤最後一檔價位: ${lastVendorBidPrice} ${vendorPair}`)

  if (averageBitoAskPrice.isLessThan(averageVendorBidPrice)) {
    let profitTotalValue = averageVendorBidPrice.minus(averageBitoAskPrice).multipliedBy(targetAmount)
    // buy from bito，以bito總價值為分母計算profit

    // profitTotalValue需要扣掉兩張單子在各自交易所的手續費
    let profit = profitTotalValue.dividedBy(totalBitoValue).multipliedBy(100)
    console.log(`Profit: ${profit.toString()} %`)

    let vendorBalances = await vendor.fetchBalance()
    let vendorFreeSellBalance = vendorBalances[vendorSellSymbol].free

    let bitoBalances = await bitopro.getAccountBalances()
    bitoBalances = bitoBalances.data
    let bitoFreeBuyBalance = 0
    bitoBalances.forEach(balance => {
      if (balance.currency.toUpperCase() === bitoBuySymbol) {
        bitoFreeBuyBalance = balance.available
      }
    })

    console.log('-----------------------餘額檢查----------------------------')
    console.log(`vendorFreeSellBalance: ${vendorFreeSellBalance} ${vendorSellSymbol}`)
    console.log(`vendorFreeSellBalance需要大於 ${targetAmount} ${vendorSellSymbol}`)
    console.log(`bitoFreeBuyBalance: ${bitoFreeBuyBalance} ${bitoBuySymbol}`)
    console.log(`bitoFreeBuyBalance需要大於: ${totalBitoValue} ${bitoBuySymbol}`)
    console.log('----------------------------------------------------------')

    // TODO:
    // ##### 要多檢查account balance都足夠才正式下單，要修改profit.isGreaterThanOrEqualTo(openOrderProfitPercentThreshold) #####
    // ##### profit要扣掉兩邊交易所扣掉的手續費計算才會精準 #####
    if (profit.isGreaterThanOrEqualTo(openOrderProfitPercentThreshold) && lastVendorBidPrice && lastBitoAskPrice > 0) {
      if (new BigNumber(vendorFreeSellBalance).isGreaterThanOrEqualTo(targetAmount)
        && new BigNumber(bitoFreeBuyBalance).isGreaterThanOrEqualTo(totalBitoValue)) {
      // 超過設定的profit門檻，開始使用限價單最爛的價格下單，一次把量吃完，門檻越高，下單後真的成功獲利的機率越高，但越不容易搬磚套利成功下出單
        targetAmount = targetAmount.toString()
        let vendorOrder = {
          pair: vendorPair,
          amount: targetAmount,
          price: lastVendorBidPrice,
          action: 'sell',
          type: 'limit'
        }

        let bitoOrder = {
          pair: bitoPair,
          action: 'buy',
          amount: targetAmount,
          price: lastBitoAskPrice,
          timestamp: Date.now(),
          type: 'limit'
        }

        console.log('-----------------------下單參數----------------------------')
        console.log(`BitoPro pair: ${bitoPair}`)
        console.log('Buy from BitoPro:')
        console.log(bitoOrder)

        console.log(`${vendorName} pair: ${vendorPair}`)
        console.log(`Sell to ${vendorName}:`)
        console.log(vendorOrder)
        console.log(`預期Profit: ${profit.toString()} % `)
        console.log('----------------------------------------------------------')

        try {
          let vendorOrderResult = await vendor.createLimitSellOrder(vendorPair, vendorOrder.amount, vendorOrder.price)
          let bitoOrderResult = await bitopro.createOrder(bitoOrder)

          console.log(vendorOrderResult)
          console.log(bitoOrderResult)

          let vendorOrderID = vendorOrderResult.id
          let bitoOrderID = bitoOrderResult.orderId

          let vendorOrderStatus = await vendor.fetchOrder(vendorOrderID, vendorPair)
          let bitoOrderStatus = await bitopro.getOrder(bitoPair, bitoOrderID)
          console.log('-----------------------下單結果----------------------------')
          console.log(vendorOrderStatus)
          console.log(bitoOrderStatus)
          console.log('----------------------------------------------------------')
        } catch (e) {
          console.log(e)
        }
      } else {
        console.log('-----------------------結果-------------------------------')
        console.log('餘額不足不下單')
        console.log('----------------------------------------------------------')
      }
    } else {
      console.log('-----------------------結果-------------------------------')
      console.log('Profit未超過設定門檻不下單')
      console.log('----------------------------------------------------------')
    }
  } else {
    console.log('-----------------------結果-------------------------------')
    console.log(`Buy from BitoPro sell to ${vendorName} 無套利空間不下單`)
    console.log('----------------------------------------------------------')
  }
}

let intentToBuyFromBitoSellToVendor = async () => {
  try {
    console.log(`----------------開始從BitoPro買${vendorName}賣-------------------`)
    let bitoLevel = 0
    let totalValue = new BigNumber(0)
    let bitoAmount = new BigNumber(0)
    let maxValuePerArbitrageBN = new BigNumber(maxValuePerArbitrage)

    for (let i = 0; i < bitoOrderbook.asks.length; i++) {
      let ask = bitoOrderbook.asks[i]
      let askPrice = ask.price
      let askAmount = ask.amount
      bitoAmount = bitoAmount.plus(askAmount)
      totalValue = totalValue.plus((new BigNumber(askPrice).multipliedBy(askAmount)))
      bitoLevel++
      if (totalValue.isGreaterThan(maxValuePerArbitrageBN)) {
        bitoAmount = bitoAmount.minus(askAmount)
        totalValue = totalValue.minus((new BigNumber(askPrice).multipliedBy(askAmount)))

        maxValuePerArbitrageBN = maxValuePerArbitrageBN.minus(totalValue)
        let lastAmount = maxValuePerArbitrageBN.dividedBy(askPrice)
        bitoAmount = bitoAmount.plus(lastAmount)
        totalValue = totalValue.plus((new BigNumber(askPrice).multipliedBy(lastAmount)))
        break
      }
    }

    console.log(`不超過目標BitoPro買單總值 ${maxValuePerArbitrage} ${bitoBuySymbol}，前 ${bitoLevel} 檔，深度價值總值 ${totalValue.toString()} ${bitoBuySymbol}`)
    console.log(`目標BitoPro買單量 ${bitoAmount} ${bitoSellSymbol}`)

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

    console.log(`不超過目標${vendorName}賣單總值 ${maxValuePerArbitrage} ${vendorBuySymbol}，前 ${vendorLevel} 檔，深度價值總值 ${totalValue.toString()} ${vendorBuySymbol}`)
    console.log(`目標${vendorName}賣單量 ${vendorAmount} ${vendorSellSymbol}`)

    let targetAmount = (bitoAmount.isGreaterThan(vendorAmount)) ? vendorAmount : bitoAmount

    await checkBuyFromBitoSellToVendorWithAmount(targetAmount, vendorLevel, bitoLevel)
  } catch (e) {
    console.log(e)
  }
}

let checkBuyFromVendorSellToBitoWithAmount = async (targetAmount, vendorLevel, bitoLevel) => {
  // 以targetAmount為主算均價，再來算profit，target amount單位如: btc_usdt，則為btc數量
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

  console.log(`${vendorName}目標買單量: ${targetAmount} ${vendorSellSymbol}`)
  console.log(`${vendorName}目標買單均價: ${averageVendorAskPrice.toString()} ${vendorPair}`)
  console.log(`${vendorName}賣盤最後一檔價位: ${lastVendorAskPrice} ${vendorPair}`)

  let totalBitoValue = new BigNumber(0)
  let tempBitoAmount = new BigNumber(0)
  let averageBitoBidPrice = new BigNumber(0)
  let lastBitoBidPrice = 0

  for (let i = 0; (i < bitoLevel) && (i < bitoOrderbook.bids.length); i++) {
    let bid = bitoOrderbook.bids[i]
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

  console.log(`BitoPro目標賣單量: ${targetAmount} ${bitoSellSymbol}`)
  console.log(`BitoPro目標賣單均價: ${averageBitoBidPrice.toString()} ${bitoPair}`)
  console.log(`BitoPro買盤最後一檔價位: ${lastBitoBidPrice} ${bitoPair}`)

  if (averageVendorAskPrice.isLessThan(averageBitoBidPrice)) {
    let profitTotalValue = (averageBitoBidPrice.minus(averageVendorAskPrice)).multipliedBy(targetAmount)
    // buy from vendor，以vendor總價值為分母計算profit
    // profitTotalValue需要扣掉兩張單子在各自交易所的手續費
    let profit = profitTotalValue.dividedBy(totalVendorValue).multipliedBy(100)
    console.log(`Profit: ${profit.toString()} %`)

    let vendorBalances = await vendor.fetchBalance()
    let vendorFreeBuyBalance = vendorBalances[vendorBuySymbol].free

    let bitoBalances = await bitopro.getAccountBalances()
    bitoBalances = bitoBalances.data
    let bitoFreeSellBalance = 0
    bitoBalances.forEach(balance => {
      if (balance.currency.toUpperCase() === bitoSellSymbol) {
        bitoFreeSellBalance = balance.available
      }
    })

    console.log('-----------------------餘額檢查----------------------------')
    console.log(`vendorFreeBuyBalance: ${vendorFreeBuyBalance} ${vendorBuySymbol}`)
    console.log(`vendorFreeBuyBalance需要大於 ${totalVendorValue} ${vendorBuySymbol}`)
    console.log(`bitoFreeSellBalance: ${bitoFreeSellBalance} ${bitoSellSymbol}`)
    console.log(`bitoFreeSellBalance需要大於: ${targetAmount} ${bitoSellSymbol}`)
    console.log('----------------------------------------------------------')

    // TODO:
    // ##### 要多檢查account balance都足夠才正式下單，要修改profit.isGreaterThanOrEqualTo(openOrderProfitPercentThreshold) #####
    // ##### profit要扣掉兩邊交易所扣掉的手續費計算才會精準 #####
    if (profit.isGreaterThanOrEqualTo(openOrderProfitPercentThreshold) && lastVendorAskPrice && lastBitoBidPrice > 0) {
      if (new BigNumber(vendorFreeBuyBalance).isGreaterThanOrEqualTo(totalVendorValue)
        && new BigNumber(bitoFreeSellBalance).isGreaterThanOrEqualTo(targetAmount)) {
      // 超過設定的profit門檻，開始使用限價單最爛的價格下單，一次把量吃完，門檻越高，下單後真的成功獲利的機率越高，但越不容易搬磚套利成功下出單
        targetAmount = targetAmount.toString()
        let vendorOrder = {
          pair: vendorPair,
          amount: targetAmount,
          price: lastVendorAskPrice,
          action: 'buy',
          type: 'limit'
        }

        let bitoOrder = {
          pair: bitoPair,
          action: 'sell',
          amount: targetAmount,
          price: lastBitoBidPrice,
          timestamp: Date.now(),
          type: 'limit'
        }

        console.log('-----------------------下單參數----------------------------')
        console.log(`${vendorName} pair: ${vendorPair}`)
        console.log(`Buy from ${vendorName}:`)
        console.log(vendorOrder)

        console.log(`BitoPro pair: ${bitoPair}`)
        console.log('Sell to BitoPro:')
        console.log(bitoOrder)
        console.log(`預期Profit: ${profit.toString()} % `)
        console.log('----------------------------------------------------------')

        try {
          let vendorOrderResult = await vendor.createLimitBuyOrder(vendorPair, vendorOrder.amount, vendorOrder.price)
          let bitoOrderResult = await bitopro.createOrder(bitoOrder)

          console.log(vendorOrderResult)
          console.log(bitoOrderResult)

          let vendorOrderID = vendorOrderResult.id
          let bitoOrderID = bitoOrderResult.orderId

          let vendorOrderStatus = await vendor.fetchOrder(vendorOrderID, vendorPair)
          let bitoOrderStatus = await bitopro.getOrder(bitoPair, bitoOrderID)
          console.log('-----------------------下單結果----------------------------')
          console.log(vendorOrderStatus)
          console.log(bitoOrderStatus)
          console.log('----------------------------------------------------------')
        } catch (e) {
          console.log(e)
        }
      } else {
        console.log('-----------------------結果-------------------------------')
        console.log('餘額不足不下單')
        console.log('----------------------------------------------------------')
      }
    } else {
      console.log('-----------------------結果-------------------------------')
      console.log('Profit未超過設定門檻不下單')
      console.log('----------------------------------------------------------')
    }
  } else {
    console.log('-----------------------結果-------------------------------')
    console.log(`Buy from ${vendorName} sell to BitoPro 無套利空間不下單`)
    console.log('----------------------------------------------------------')
  }
}

let intentToBuyFromVendorSellToBito = async () => {
  try {
    console.log(`----------------開始從${vendorName}買BitoPro賣-------------------`)
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

    console.log(`不超過目標${vendorName}買單總值 ${maxValuePerArbitrage} ${vendorBuySymbol}，前 ${vendorLevel} 檔，深度價值總值 ${totalValue.toString()} ${vendorBuySymbol}`)
    console.log(`目標${vendorName}買單量 ${vendorAmount} ${vendorSellSymbol}`)

    let bitoLevel = 0
    totalValue = new BigNumber(0)
    let bitoAmount = new BigNumber(0)
    maxValuePerArbitrageBN = new BigNumber(maxValuePerArbitrage)

    for (let i = 0; i < bitoOrderbook.bids.length; i++) {
      let bid = bitoOrderbook.bids[i]
      let bidPrice = bid.price
      let bidAmount = bid.amount
      bitoAmount = bitoAmount.plus(bidAmount)
      totalValue = totalValue.plus((new BigNumber(bidPrice).multipliedBy(bidAmount)))
      bitoLevel++
      if (totalValue.isGreaterThan(maxValuePerArbitrageBN)) {
        bitoAmount = bitoAmount.minus(bidAmount)
        totalValue = totalValue.minus((new BigNumber(bidPrice).multipliedBy(bidAmount)))

        maxValuePerArbitrageBN = maxValuePerArbitrageBN.minus(totalValue)
        let lastAmount = maxValuePerArbitrageBN.dividedBy(bidPrice)
        bitoAmount = bitoAmount.plus(lastAmount)
        totalValue = totalValue.plus((new BigNumber(bidPrice).multipliedBy(lastAmount)))
        break
      }
    }

    console.log(`不超過目標BitoPro賣單總值 ${maxValuePerArbitrage} ${bitoBuySymbol}，前 ${bitoLevel} 檔，深度價值總值 ${totalValue.toString()} ${bitoBuySymbol}`)
    console.log(`目標BitoPro賣單量 ${bitoAmount} ${bitoSellSymbol}`)

    let targetAmount = (bitoAmount.isGreaterThan(vendorAmount)) ? vendorAmount : bitoAmount

    await checkBuyFromVendorSellToBitoWithAmount(targetAmount, vendorLevel, bitoLevel)
  } catch (e) {
    console.log(e)
  }
}

let detectAndOpenOrders = async () => {
  try {
    if (vendorStatus && bitoStatus) {
      await intentToBuyFromBitoSellToVendor()
      await intentToBuyFromVendorSellToBito()
      // return Promise.all([intentToBuyFromBitoSellToVendor(), intentToBuyFromVendorSellToBito()])
    }
  } catch (e) {
    console.log(e)
  }
}

let main = async () => {
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
  }, 2000)
}

startUpdateVendorOrderbook()
startUpdateBitoOrderbook()
main()
