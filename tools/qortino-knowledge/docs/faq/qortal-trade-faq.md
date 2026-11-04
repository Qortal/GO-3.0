# qortal-trade — golden FAQ

Curated offline Q&A for Qortino (173 entries). Prefer these answers when relevant.

## Q: How do I send QORT in Qortal Hub?

A: Click the account button in Hub's top bar and choose Send QORT, or use Send on the Wallet Activity card on Home.
Enter a Qortal address or registered name, the amount and your wallet password, then click Send.
Hub shows the recipient's name and full address, the amount and the fee before you confirm. Payments can't be reversed.

Also asked as: send qort in hub · qortal hub send qort · pay qort from hub · hub desktop qort payment · transfer qort qortal hub

## Q: What is the fee for sending QORT?

A: A QORT payment costs a small network fee, currently 0.01 QORT, on top of the amount you send. Hub and GO show the fee in the confirmation and never sign a higher fee than the one you saw: if the node asks for more, nothing is sent. The fee goes to the minters who run the network, not to a company.

Also asked as: qort payment fee · how much does it cost to send qort · send qort fee · transfer fee qort · fee to pay someone qort

## Q: How long does a QORT payment take to arrive?

A: Usually about a minute. A payment confirms in the next block, and Qortal makes a block roughly every minute. Your balance and Wallet Activity update once it's confirmed; if it takes much longer, check that your node is online and synced.

Also asked as: how long does qort take to send · qort payment time · when will my qort arrive · qort transfer how fast · qort payment not arrived yet

## Q: Can I cancel or reverse a QORT payment?

A: No. Once a payment is sent it can't be cancelled, reversed or charged back, and nobody can do it for you. The only way to get it back is for the person who received it to send it back. Check the name, full address and amount in the confirmation before you accept.

Also asked as: undo qort payment · reverse qort transfer · cancel qort payment · refund a qort payment · chargeback qort · reverse a payment

## Q: Where can I see my past QORT payments?

A: On Home, open the Wallet Activity card and tap Transaction history under the latest payment. It lists your payments newest first (who, sent or received, when and the amount), 20 at a time with Show more, and you can tap a name to look that account up. Q-Wallets also lists every QORT transaction, with filters.

Also asked as: qort transaction history · see past payments qortal · wallet history qort · where are my qort transactions · payment history hub go · who paid me

## Q: How do payment alerts work in Qortal GO?

A: When QORT arrives in your account, GO shows an alert titled Payment from <name>, with the payer's avatar and the text You received <amount> QORT. If the payer has no registered name, it shows a short address and the Q-Wallets icon. Each payment alerts once, and it's also listed in the bell.

Also asked as: payment notification qortal go · qort received alert · go payment alert · notified when i get qort · payment from notification · payment received notification

## Q: Which coins can I keep in my Qortal wallet?

A: Every Qortal account in Hub and GO has wallets for QORT, Bitcoin (BTC), Litecoin (LTC), Dogecoin (DOGE), DigiByte (DGB), Ravencoin (RVN) and Pirate Chain (ARRR). Each coin has its own address. You see and use them in Q-Wallets, and they're the coins Q-Trade trades against QORT.

Also asked as: coins in qortal wallet · which cryptocurrencies qortal wallet holds · qortal wallet supported coins · can i hold bitcoin in qortal · qortal go btc ltc wallets

## Q: Where do I find my Litecoin address?

A: Open Q-Wallets (Wallets in GO's avatar menu or in Home's Quick tools), pick Litecoin and tap Receive to see the address and its QR code, with a copy button. In Q-Trade, pick LTC in the coin selector and tap Receive next to the LTC balance. Your LTC address is not the same as your QORT address.

Also asked as: my ltc address qortal · litecoin deposit address qortal · where is my litecoin address · receive ltc qortal · ltc wallet address q-wallets

## Q: Is my Litecoin address the same as my QORT address?

A: No. Each coin has its own address: your QORT address starts with Q, while your Litecoin address is a separate LTC address that starts with L. Always send each coin to that coin's own address, which Q-Wallets shows under the coin's name.

Also asked as: ltc address same as qort address · different address for each coin · qort vs ltc address · send ltc to my qort address · why two addresses qortal

## Q: How do I send Litecoin or other coins from my Qortal wallet?

A: Open Q-Wallets, pick the coin (for example Litecoin) and choose Transfer LTC. Enter the receiving address for that coin and the amount (Send max keeps the network fee back), pick a fee, then approve in Hub or GO. It works the same for BTC, DOGE, DGB, RVN and ARRR. This needs your own node, because the node signs the send with that coin's key. Double-check the address: sends can't be reversed.

Also asked as: send ltc from qortal · withdraw litecoin qortal · transfer ltc q-wallets · send dogecoin from qortal · send btc from qortal · send other coins qortal go · send dogecoin

## Q: How do I move Litecoin from an exchange into Qortal?

A: 1. Find your LTC address in Q-Wallets (Litecoin, Receive) or in Q-Trade (LTC, Receive) and copy it.
2. On the exchange, withdraw LTC to that address.
3. Wait for the Litecoin network to confirm it; the balance then shows in Q-Wallets and Q-Trade. Receiving works on the public node too.
Then you can buy QORT with it in Q-Trade.

Also asked as: send ltc from exchange to qortal · deposit litecoin qortal · fund ltc wallet qortal · transfer ltc from coinbase to qortal · exchange to qortal wallet · get ltc into qortal

## Q: Can I buy QORT with dollars, euros or a card?

A: Not inside Qortal: Q-Trade only swaps QORT for other coins (LTC, BTC, DOGE, DGB, RVN and ARRR). The usual way is to buy LTC on an exchange, send it to your Qortal LTC address, then buy QORT in Q-Trade. qortal.dev also notes that the NonKYC.io exchange lists QORT against USDT.

Also asked as: buy qort with usd · buy qort with credit card · buy qort with fiat · buy qort with paypal · buy qort with euros

## Q: What happens if a trade fails?

A: Both sides get their coins back automatically: the order's AT returns the seller's QORT, and the buyer's trade bot refunds the LTC (or other coin). Refunds wait for the trade's timeout and then for the coin's network, and network fees already spent aren't returned. If you trade on your own node, keep it running so it can do the refund.

Also asked as: failed trade refund · trade failed what happens · q-trade refund · do i get my ltc back · trade went wrong qortal

## Q: How do cross-chain trades on Qortal work?

A: 1. The seller's QORT is locked in an ACCT AT, a small contract on the Qortal chain.
2. The buyer's trade bot locks the coins (for example LTC) in a time-locked address on that coin's chain and messages the seller's trade bot.
3. The seller's trade bot locks the AT to that buyer.
4. The buyer claims the QORT with a secret, and the seller's bot uses the same secret to claim the coins.
If a step stalls, both sides are refunded.

Also asked as: how do qortal trades work · cross chain trade process · atomic swap qortal how · how q-trade works · trade bot steps qortal

## Q: How do I receive QORT in Qortal Hub?

A: Give the sender your Qortal address (it starts with Q) or your registered name. In Hub, the Wallet Activity card on Home has Receive, which shows a QR code of your address with Copy address and Download QR, and the account card on Home has Copy address and Show receive QR. You don't have to approve anything: the QORT arrives when the payment confirms.

Also asked as: receive qort in hub · qortal hub receive qort · hub receive qr code · get paid qort on desktop · hub copy my address

## Q: Can someone pay me using my registered name instead of my address?

A: Yes. Send QORT in Hub and GO, Q-Wallets and Q-Trade's Send all accept a registered name. Before the confirmation, the app looks up which address owns the name and pays that address, showing both the name and the full address. If a name later changes owner, payments to it go to the new owner, so check the address when it matters.

Also asked as: pay to a name qort · send qort to registered name · qort payment by name · pay my name instead of address · send qort to username

## Q: How do I pay someone I'm chatting with?

A: Tap the person's name or avatar in the chat and choose Send QORT. The Send QORT window opens with their address filled in; enter the amount and your wallet password, then confirm. You can also find anyone in User search (Address book in GO's avatar menu) and tap Send QORT there.

Also asked as: send qort from chat · pay someone in q-chat · tip someone in chat qort · send qort to chat contact · pay a friend qort chat

## Q: How do I check an account before I send it QORT?

A: Open User search: in GO tap your avatar and choose Address book, in Hub use User Search in Home's Quick tools. Enter a name or address to see the account's level, balance, address, public key and recent payments, with a Send QORT button. It's a quick way to make sure you have the right person before paying.

Also asked as: user search qortal · look up qortal account · check account before paying · qortal address book lookup · verify recipient qortal

## Q: What does "This QR code is not a Qortal payment code" mean?

A: GO's scanner read the code but found no Qortal payment in it, for example a website link or another wallet's payment code. Send QORT accepts qortal://pay and qortal://send links, qort: codes and plain Qortal addresses. Ask the payee for a Qortal payment QR, or type their address or name into To.

Also asked as: not a qortal payment code · qr code not recognized go · scan error send qort · qortal go cant read payment qr · invalid payment qr qortal

## Q: How do I make a QR code so people can pay me with Qortal GO?

A: Turn this text into a QR code with any QR generator: qortal://pay?recipient=YOUR_ADDRESS&amount=5. Leave out &amount=5 to let the payer type the amount, and you can use your registered name instead of the address (write a space as %20). Anyone who scans it with their phone's scanner gets GO's Send QORT screen filled in, and confirms with their own password.

Also asked as: make payment qr code qortal · qr code to get paid qort · create qortal pay qr · shop qr code qort payment · invoice qr qortal go · make a qr code to get paid

## Q: Why can't my phone's camera open my Qortal address QR code?

A: A QR code with only an address is plain text, so Android can't tell it belongs to GO. Scan it from inside GO instead (Send QORT, then the QR icon in To), or use a qortal://pay?recipient=... code, which any scanner can hand to GO. GO's Receive QR holds your plain address, so payers should scan it from inside GO.

Also asked as: camera cant open qortal qr · address qr not opening go · phone scanner qortal address · cant open an app for this qr code · qr code wont open qortal go

## Q: I sent QORT to the wrong address. What can I do?

A: A payment can't be undone, so the only way back is to ask the owner of that address to return it. Look the address up in User search to see whether it has a registered name you can message in Q-Chat. Hub and GO refuse a mistyped address before sending, so a wrong payment usually means a wrong but real address.

Also asked as: sent qort to wrong address · wrong recipient qort · qort payment mistake · qort sent to wrong person · get back qort sent by mistake

## Q: What does "Your QORT balance is insufficient" mean when I send?

A: Your balance doesn't cover the amount plus the 0.01 QORT payment fee. Send a little less so the fee fits, or wait for incoming QORT to confirm. Send QORT shows your balance at the top of the window.

Also asked as: qort balance is insufficient · insufficient balance send qort · not enough qort to send · insufficient funds qort payment · cant send all my qort

## Q: Can I send QORT while I'm on the public node?

A: Yes. QORT payments are signed in Hub or GO and only passed to the node, so they work on the public node too. What needs your own node is sending other coins (LTC, BTC and so on), using the ARRR wallet and selling on Q-Trade.

Also asked as: send qort public node · pay qort on gateway · qort payments public node · can i pay on the public node · qortal go public node send qort

## Q: What happens when I tap a payment alert?

A: It opens Q-Wallets, where you can see your balance and the payment in its transaction list. Payments listed in the bell open Q-Wallets the same way.

Also asked as: tap payment notification · payment alert opens q-wallets · why does payment alert open wallets · open payment notification go · payment alert tap

## Q: Why didn't I get an alert for a payment I received?

A: Alerts come from your node for the account you're logged in to, so check you're on the account that was paid and that GO is connected to its node. Also check the Disable all push notifications switch in the bell panel. Once the payment is confirmed it shows in Wallet Activity whether or not an alert appeared.

Also asked as: no payment notification · didnt get payment alert · payment alert missing go · qort arrived no notification · payment notification not working

## Q: How do I open Q-Wallets?

A: In GO, tap your avatar and choose Wallets. In Hub or GO you can also tap Wallets in Home's Quick tools, or open qortal://APP/Q-Wallets. Tapping a payment alert opens it too.

Also asked as: open q-wallets · where is q-wallets in go · qortal wallets app · how to open wallets go · q-wallets hub

## Q: What is Q-Wallets?

A: Your Qortal account is your QORT wallet, and Q-Wallets is Qortal's official app for managing it and your other coins. It shows balances and transaction history for QORT, BTC, LTC, DOGE, DGB, RVN and ARRR, and lets you send, receive with QR codes, keep an address book for each coin and choose network fees (low, medium, high or custom). It doesn't store your keys: Hub or GO handle them and ask you to approve each send.

Also asked as: q-wallets app · what does q-wallets do · qortal multi coin wallet · q-wallets qortal · multi wallet qortal app · how to use q-wallets

## Q: Can I see my LTC or BTC balance on the public node?

A: Yes. For BTC, LTC, DOGE, DGB and RVN, Hub and GO read the balance and history with your public wallet key, which can't spend anything, so it works on the public node. ARRR is different: its balance needs the ARRR seed on the node, so it needs your own node.

Also asked as: ltc balance public node · see btc balance gateway · foreign coin balance qortal go · check ltc balance without node · other coin balances public node

## Q: Why can't I use my ARRR wallet on the public node?

A: Every ARRR wallet action, even showing the address, balance or sync status, sends your ARRR seed to the node, and that seed can spend the wallet. Hub and GO never send it to a public node, and Q-Wallets says: You cannot use Pirate Chain wallet through public node. Please use your local node. Run your own node to use ARRR.

Also asked as: arrr wallet public node · pirate chain wallet not working · cannot use pirate chain wallet through public node · arrr needs local node · arrr wallet qortal go

## Q: Which Litecoin addresses can I send to from Q-Wallets?

A: Q-Wallets accepts all three common LTC formats: 34-character addresses starting with L or M, and 43-character addresses starting with ltc1. It checks the format before sending, so an exchange's deposit address in any of these forms works.

Also asked as: ltc address types q-wallets · send ltc to ltc1 address · ltc m address qortal · segwit ltc qortal · litecoin address format qortal

## Q: How do network fees work when I send LTC, BTC or DOGE?

A: Each coin's own network takes the fee, not Qortal. Q-Wallets lets you pick Low, Medium or High (recommended rates from fee publishers on QDN) or set a Custom fee, and shows the current fee. Low fees may result in slow or unconfirmed transactions. Send max holds the fee back for you.

Also asked as: ltc network fee · send btc fee q-wallets · foreign coin fees qortal · low medium high fee q-wallets · custom fee litecoin

## Q: How do I send LTC from Qortal to an exchange?

A: Use Q-Wallets with your own node: Litecoin, Transfer LTC, paste the exchange's LTC deposit address, enter the amount and a fee, then approve. Check that it's an LTC address and copied exactly, because sends can't be reversed. On the public node, GO blocks sending coins other than QORT.

Also asked as: withdraw ltc to exchange · send litecoin to exchange from qortal · ltc to binance from qortal · cash out ltc qortal · move ltc out of qortal · send ltc to exchange · withdraw ltc

## Q: Why is my LTC balance missing or not showing a deposit?

A: Balances of other coins come through your node, which asks that coin's network, and a deposit only counts once Litecoin confirms it, which can take around 10 minutes. Q-Trade shows a spinner until the balance arrives and refreshes it every 2.5 minutes. If it still doesn't show, check you used your Qortal LTC address (not your QORT address) and that your node is connected.

Also asked as: ltc balance not showing · litecoin deposit not showing qortal · ltc balance zero qortal · foreign balance not loading · q-trade balance spinner

## Q: How do I save addresses in Q-Wallets?

A: Each coin has its own address book. Open it from the coin's page, tap Add contact, enter a name, the address and an optional note, and confirm the address before saving; for QORT you can search by registered name. Encrypted sync backs the address book up to QDN so it follows your Qortal account to other devices.

Also asked as: q-wallets address book · save contact address qortal · address book ltc q-wallets · save qort address contact · address book sync qdn

## Q: How do I receive Bitcoin, Dogecoin or other coins in Qortal?

A: Open Q-Wallets, pick the coin and tap Receive to show its address and QR code, then give that address to the sender. Each coin has its own address, and receiving works on the public node too, except ARRR, which needs your own node. The balance updates once that coin's network confirms the transaction.

Also asked as: receive btc qortal · receive dogecoin qortal · receive other coins qortal go · btc deposit address qortal · get my doge address · receive bitcoin in qortal · find my btc address

## Q: Send QORT says "Invalid receiver address or name" or "Name does not exist". What is wrong?

A: Invalid receiver address or name means the text is neither a valid Qortal address (a mistyped address fails its built-in check) nor something that can be a name. Name does not exist means nobody has registered that name: check the spelling, or ask the person for their address.

Also asked as: invalid receiver address or name · name does not exist send qort · send qort recipient error · qort address not valid · recipient not found qort

## Q: Does Qortal Hub alert me when I receive QORT?

A: Yes. When a payment arrives, Hub shows a desktop notification titled Payment from <name> (or New payment received) saying You received <amount> QORT, and the payment is listed in the bell. Clicking it opens Q-Wallets. The Disable all push notifications switch in the bell panel turns these off with all other alerts.

Also asked as: hub payment notification · desktop alert qort received · qortal hub payment alert · hub notifies payment · payment notification desktop

## Q: Is the Trade Portal the same thing as Q-Trade?

A: The Trade Portal was the trading screen built into the old Qortal UI. In Qortal Hub and GO you trade in the Q-Trade Q-App, which uses the same trade system in Qortal Core underneath. The Buy button on Home's Wallet Activity card opens Q-Trade.

Also asked as: trade portal vs q-trade · where did the trade portal go · trade portal in qortal hub · old trade portal qortal ui · is q-trade the same as the trade portal

## Q: Do I need QORT to buy my first QORT?

A: No. You can buy QORT in Q-Trade with only another coin, usually LTC. On the public node, if you hold fewer than 4 QORT, your encrypted buy request is held briefly on a database until it reaches the trade proxy, instead of going straight through Q-Chat.

Also asked as: buy qort with no qort · first qort with ltc · zero qort buy order · need qort to trade · buy qort new account

## Q: Who sets the prices on Q-Trade?

A: Sellers do. Each seller lists QORT at the rate they choose, and buyers pick whichever orders they want; there are no buy or sell walls and no matching engine. Q-Trade sorts open orders by price per QORT, lowest first, and Trade History shows recent trades.

Also asked as: who decides qort price q-trade · how are q-trade prices set · qort sell order prices · no sell walls qortal · trade portal pricing

## Q: Can I buy only part of a sell order?

A: No. Each sell order is bought whole: if an order is 100 QORT, you buy all 100. To get a different amount, tick several smaller orders that add up to what you want.

Also asked as: partial buy q-trade · buy part of an order qortal · split sell order q-trade · buy less than the order q-trade · q-trade partial fill · buy half an order

## Q: Can I buy several sell orders at once?

A: Yes. Tick as many orders as you like under Open Market Sell Orders and tap BUY once; Hub or GO asks you to approve them together, showing the number of orders, the QORT and the coin total. ARRR is the exception: Q-Trade buys one ARRR order at a time.

Also asked as: buy multiple orders q-trade · select several orders q-trade · buy many sell orders at once · q-trade multi select · buy two orders together

## Q: How much LTC do I need to buy a sell order?

A: The order's total LTC value plus one unlocking fee for each order you buy. Q-Trade adds it up in the bar at the bottom (the LTC total with unlocking fees, next to your LTC balance) and marks the total red if your balance is too low. Keep a little extra for the locking fee shown in the approval.

Also asked as: how much ltc to buy qort · ltc needed for an order · q-trade total with unlocking fees · is my ltc balance enough · cost of a sell order in ltc

## Q: What is the unlocking fee in Q-Trade?

A: It's the Litecoin (or other coin) network fee needed to unlock the coins at the end of a trade so the seller can collect them. Sellers sign the fee their orders need, and Q-Trade shows it per order in the Unlocking fee column. Your node's unlocking fee is added to your total for each order you buy, and it goes to that coin's network, not to Qortal or Q-Trade.

Also asked as: what is the unlocking fee · unlocking fee meaning · q-trade fee sats · unlocking fee column · why extra ltc fee q-trade

## Q: Why can't I select some orders in Q-Trade, or why are they red?

A: The seller needs a higher unlocking fee than your node's current fee, so a buy could fail; Q-Trade colours those orders red, blocks them and notes that your unlocking fee is too low to buy them. On your own node, raise your fee with the Fee button next to the coin selector. On the public node you can't change it, so pick other orders.

Also asked as: red orders q-trade · cant select order q-trade · unlocking fee too low · increase your fee to purchase · q-trade order greyed out

## Q: Q-Trade says some orders have unknown unlocking fees. What should I do?

A: Those sellers haven't signed the fee their orders need. Q-Trade asks whether to Remove orders with unknown unlocking fees or Keep them. You may keep them, but there's a higher risk those trades won't go through; if one fails, you're refunded.

Also asked as: unknown unlocking fees · q-trade warning unknown fee · remove orders with unknown unlocking fees · keep orders unknown fee · unlocking fee unknown

## Q: Does Q-Trade charge its own fee?

A: No. Q-Trade's terms say its maintainers don't profit and there are no extra fees for buying QORT through it. You pay only network fees: small QORT transaction fees and the other coin's network fees for locking and unlocking.

Also asked as: q-trade fees · does q-trade take a cut · trade portal fee · q-trade commission · extra fees buying qort · fee q-trade charges · is there a fee to trade

## Q: What does My Pending Orders show in Q-Trade?

A: It lists the buy orders you've submitted from Q-Trade on this device in the last day, for the coin selected, with their Status, amounts and Notes. It updates as the trade goes on, and an order another buyer completed drops off the list.

Also asked as: my pending orders q-trade · pending orders table · where is my buy order · q-trade pending · track my buy order

## Q: What do the statuses in My Pending Orders mean?

A: Requested: your buy request was sent and is waiting for trade confirmation.
Submitted: the buy order was accepted and is under way.
Trading: the order is changing hands; this doesn't yet mean your account got it.
Completed: you bought it; wait for your QORT balance to update.
Failed: the buy didn't go through, and the Notes say why.

Also asked as: q-trade status meaning · requested submitted trading completed · pending order status q-trade · q-trade trading status · what does trading mean q-trade

## Q: Q-Trade says "Order(s) already taken". What happened?

A: Another buyer got to that sell order before you, so your buy didn't go through; pick another order. Q-Trade warns that submitting an order doesn't mean yours will be the one that completes it. If any of your coins were already locked, they're refunded automatically after the trade's timeout.

Also asked as: order already taken · orders already taken q-trade · someone else bought my order · buy failed already taken · q-trade invalid search criteria

## Q: Can I close Q-Trade or GO while my buy is running?

A: Wait until Q-Trade answers: while it says Attempting to submit buy order, don't leave the app. Once it says Successfully submitted order, the trade bot on the node finishes the trade. If you trade on your own node, keep that node running and synced until the trade completes.

Also asked as: close q-trade during buy · leave app while buying qort · keep go open during trade · attempting to submit buy order · close hub during trade

## Q: How long does a Q-Trade purchase take?

A: Usually several minutes, not seconds. A trade needs several transactions that must confirm on both chains: QORT blocks come about every minute, while Litecoin confirmations take longer, and a busy network or a low fee slows things down. Watch My Pending Orders until it says Completed.

Also asked as: how long does q-trade take · buy qort time · trade taking long · how long until qort arrives trade · q-trade slow

## Q: I bought QORT but my balance hasn't changed. What now?

A: If My Pending Orders says Completed, the QORT was redeemed to your account; give the balance a moment to update (Q-Trade refreshes balances every 2.5 minutes). If it still says Trading, the trade isn't finished yet. Your finished buys also appear under Trade History, My Buy History.

Also asked as: bought qort balance not updated · qort not arrived after trade · q-trade completed no qort · where is my qort after buying · trade done balance same

## Q: How long until a failed trade refunds my LTC?

A: Your locked coins can be refunded once the order's trade timeout has passed: for sell orders made in Hub or GO that's 2 hours after your buy started. The trade bot then sends the refund, which still needs the coin's network to confirm. The seller's app sets the timeout, so orders made elsewhere can differ.

Also asked as: how long for ltc refund · refund time failed trade · when do i get my ltc back · refunding status time · trade timeout refund · how long for refund

## Q: My refund still hasn't arrived. What can I do?

A: Give it time first: the trade timeout, then the coin's own confirmations. If you traded on your own node, keep Core running and don't delete its database; if a refund still hasn't come long after that, your node's API can retry failed refunds with POST /crosschain/htlc/refundAll (with your API key), after POST /admin/repository/importarchivedtrades if it returns false. If you traded on the public node, keep your saved trade record and ask in Qortal's community chats.

Also asked as: refund not arrived · ltc refund missing · stuck trade refund · refundall qortal · trade stuck refunding · refund didn't arrive

## Q: What is a trade bot?

A: It's the part of Qortal Core that carries out a trade's steps for you: it creates the AT or locks the coins, sends the messages and claims or refunds the coins. It runs on the node where the trade started, so that node has to stay online and synced until the trade finishes.

Also asked as: tradebot qortal · what is the trade bot · qortal core tradebot · trade bot node · who runs my trade

## Q: What does atomic cross-chain trade (ACCT) mean?

A: It's a swap between two blockchains that either completes for both people or fails for both, with no third party holding the coins at any point. Qortal calls these ACCTs (atomic cross-chain trades) rather than atomic swaps. If one fails, each side gets their original coins back.

Also asked as: acct qortal · atomic cross chain trade · atomic swap qortal · what is acct · atomic trade meaning

## Q: What is trade presence?

A: Sellers' nodes regularly announce that they're online and ready to trade. Q-Trade lists only sell orders whose seller has announced recently, so you don't buy from a node that's offline. Your own orders without a recent announcement show under Stuck orders.

Also asked as: trade presence qortal · why orders disappear q-trade · offline seller orders · presence transactions · q-trade online sellers

## Q: Why does Q-Trade keep showing Loading Trades?

A: Q-Trade waits until it has both the open orders and the sellers' presence data from the node before it shows the list. If it stays on Loading Trades, the node may be slow or still syncing; give it a moment, then close and reopen Q-Trade.

Also asked as: q-trade loading trades · q-trade stuck loading · no orders showing q-trade · q-trade empty list · loading trades forever · q-trade not loading

## Q: What does "You don't have enough LTC or your balance was not retrieved" mean?

A: Your selected orders plus unlocking fees cost more than your LTC balance, or Q-Trade hasn't loaded your balance yet. Untick an order, or wait for the balance to appear (it refreshes every 2.5 minutes). For ARRR, the balance only loads on your own node.

Also asked as: you don't have enough ltc · balance was not retrieved · not enough ltc q-trade · q-trade insufficient ltc · q-trade balance error

## Q: What does "Failed to submit buy order" mean?

A: The buy didn't get through, so nothing was bought; the message under it says why. Examples are declining the approval, Cannot make trade. Gateway node is synchronizing (the trade node was catching up), or Q-Trade not reaching the trade service. Check your balance and the order, then try again or pick another order.

Also asked as: failed to submit buy order · buy order failed q-trade · q-trade buy error · gateway node is synchronizing · unable to send buy order message

## Q: What does "Allow this app to perform a buy order?" show?

A: It's Hub or GO checking a Q-Trade buy before anything happens. It shows how many orders, the total QORT and coin amount, whether you're on a public node, the total unlocking fee and the locking fee rate, plus the private key warning for your node or the trade proxy. Tick the box and Accept only if it matches what you picked.

Also asked as: allow this app to perform a buy order · buy order approval · q-trade approval window · buy order permission · approve buy order go

## Q: What is the difference between trading on my own node and on the public node?

A: Own node: your node's trade bot runs the trade with your coin's key, and you can buy, sell, cancel, set fees and use ARRR.
Public node (the default in GO): you can only buy, through the Qortal trade proxy, which receives your coin's private key and completes the trade for you; submitting can take up to 3 minutes.
Either way it's a cross-chain trade with automatic refunds.

Also asked as: own node vs public node trading · gateway vs local node q-trade · difference trading public node · trade with my own node · local node trade benefits · trade without my own node · q-trade on qortal go · trade qort on my phone

## Q: Why can't I sell QORT in GO or on the public node?

A: A sell order is run by the trade bot on your node, which has to stay online to finish each trade, so it needs a node you run yourself. On a public node Q-Trade says: Managing your sell orders is not possible using a gateway node. Connect Hub or GO to your own node to sell.

Also asked as: cant sell qort on go · managing your sell orders is not possible using a gateway node · sell qort public node · sell qort without a node · q-trade sell gateway · can't sell qort on go · need my own node to sell

## Q: What is the minimum sell order on Q-Trade?

A: The order's total must be more than 0.01 LTC, 0.001 BTC, 1 DOGE, 0.01 DGB, 0.01 RVN or 0.0002 ARRR. Q-Trade shows the limit under the amounts and keeps Create sell order greyed out until the total is above it.

Also asked as: minimum sell order · smallest sell order q-trade · total sell amount needs to be greater than · create sell order greyed out · min ltc sell order

## Q: Where does my QORT go when I list a sell order?

A: Out of your balance and into the order's AT, a trade account on the Qortal chain that you still control. It stays there until a buyer completes the trade or you cancel, which returns it to you. That's why your QORT balance drops when you list.

Also asked as: qort left my balance after sell order · where is my qort in a sell order · sell order locked qort · balance dropped after listing · qort held in at

## Q: What do PENDING, LISTED and TRADING mean for my sell order?

A: PENDING: the order's AT is being created and isn't confirmed yet, so your QORT hasn't moved.
LISTED: the order is live and waiting for a buyer.
TRADING: a buyer's trade is under way; leave your node running.
BUYING and REFUNDING show for buys made from your own node. When a trade finishes, the order leaves this list and appears in Trade History.

Also asked as: sell order pending listed trading · pending sell order meaning · listed status q-trade · my sell order status · sell order trading status

## Q: Why can't I cancel my sell order?

A: Cancel sell order stays greyed out while the order is PENDING, because its AT isn't on the chain yet; wait until it's LISTED. If the order isn't in your list at all, look under Stuck orders, which can cancel it too. Cancelling needs your own node.

Also asked as: cancel button greyed out q-trade · cant cancel sell order · cancel sell order disabled · sell order wont cancel · cancel a pending order

## Q: What are stuck orders in Q-Trade?

A: They're your sell orders that are still open on the chain but haven't been announced by a node recently, so buyers can't see them in the market. Open Sell QORT, tap Stuck orders and use Cancel sell on any you want back; No stuck trades means there are none. It happens when the node that made the order hasn't been online.

Also asked as: what are stuck orders · stuck sell orders · cancel a stuck order · no stuck trades · old sell order stuck

## Q: Why doesn't my sell order show in Open Market Sell Orders?

A: Q-Trade only lists orders whose seller's node has announced it's online recently, and a new order needs a couple of minutes to reach the network. If your node was off, your order is hidden until it announces again. Keep your node running, and check Stuck orders if it doesn't come back.

Also asked as: my sell order not showing · sell order not in market · cant see my order q-trade · listed but not visible · order missing open market · my sell order disappeared

## Q: Does my node need to stay online while my QORT is for sale?

A: Yes. Your node's trade bot answers buyers and finishes the trade, and buyers only see your order while your node announces it's online. If your node is off when a buyer comes, the trade can't finish and the buyer is refunded. Don't delete or reset the node's database while you have trades.

Also asked as: node offline sell order · keep core running to sell · turn off node with sell order · sell order computer off · node must be online to sell

## Q: What does "Action required! You have unsigned fees" mean?

A: Your node has fee data for your sell orders that you haven't signed yet. Tap the button and approve the request to sign the required fees for all your trade offers. Signing tells buyers' nodes the right unlocking fee to use, so their buys of your orders go through; it doesn't move any coins.

Also asked as: action required unsigned fees · you have unsigned fees · sign fees q-trade · sign the required fees · q-trade red fees button

## Q: What happens when someone buys my sell order?

A: Your order moves to TRADING while the trade bots finish. When it's done, the LTC (or other coin) is in your own wallet for that coin in the same account, and the sale shows under Trade History, My Sell History. Keep your node running until then.

Also asked as: someone bought my qort · sell order filled · where is my ltc after selling · qort sold what next · sell order completed · where does my ltc go when i sell

## Q: My QORT was bought but my LTC hasn't arrived. What now?

A: Your node's trade bot claims the LTC after the buyer claims the QORT, so keep your node running; then the Litecoin network has to confirm it, which Q-Wallets shows as pending. If the buyer never finished, the trade times out and the AT returns your QORT instead.

Also asked as: sold qort no ltc · ltc not received after sale · buyer took qort no ltc · sell order traded ltc missing · where is my ltc from trade

## Q: Does selling QORT send my LTC private key to the node?

A: No. For LTC, BTC, DOGE, DGB and RVN, a sell order only needs your receiving address, which Hub or GO work out on your device. ARRR is the exception: getting your ARRR receiving address needs the ARRR seed on your node, so the sell approval shows the private key warning.

Also asked as: sell order private key · does selling qort need my ltc key · is selling qort key safe · sell order foreign key · selling qort arrr seed

## Q: Can I sell QORT for BTC, ARRR or other coins?

A: Yes, on your own node: pick the coin (LTC, DOGE, BTC, DGB, RVN or ARRR) in Q-Trade's coin selector before you tap New Sell Order, and set your price in that coin. Each coin has its own minimum order total, for example 0.001 BTC or 1 DOGE. For ARRR, your receiving address comes from the node, so the approval warns that your ARRR seed goes to that node.

Also asked as: sell qort for bitcoin · sell qort for arrr · sell qort for dogecoin · arrr sell order · sell qort get btc · sell qort for another coin

## Q: Can I post a buy order for QORT at my own price?

A: No. Q-Trade only has sell orders: sellers list QORT and buyers pick from them. A buy order would need the buyer's LTC held on its own chain without knowing the seller in advance, which hasn't been built. To buy, choose from Open Market Sell Orders.

Also asked as: post buy order qort · bid for qort · limit buy order q-trade · list ltc for sale qortal · buy order at my price

## Q: What does "Unable to create sell order. Please try again." mean?

A: Your node couldn't create or confirm the order's AT, so no order was made. Check that your node is synced and that you have enough QORT for the amount plus fees, then try again. Q-Trade marks the failed attempt so it doesn't show as an order.

Also asked as: unable to create sell order · sell order failed · create sell order error · failed to create sell order · sell order not created

## Q: Can I restart or bootstrap my node while a trade is running?

A: Avoid it. Qortal's trade guide says that for a trade to succeed your Core must keep running and you must not delete or change its database, because the node's trade bot does the trade. Wait until your buy or sell order shows the trade finished.

Also asked as: bootstrap during trade · restart node during trade · delete db during trade · reset core with open trade · update core during trade

## Q: My Q-Trade buy has been Trading for hours. What should I do?

A: Trading means the order is changing hands, not that it's finished or that your account got it. Leave it running: either it completes, or once the trade timeout passes (2 hours for orders made in Hub or GO) the refund can start and your coins come back. If you use your own node, keep it running and synced meanwhile.

Also asked as: buy stuck trading · trading status for hours · q-trade trade stuck · buy not completing · trade taking hours

## Q: Is it safe to buy QORT directly from a person instead of Q-Trade?

A: A direct deal means trusting the other person to send QORT after you pay, and a payment can't be reversed. In Q-Trade, a trade either completes for both sides or both are refunded, with no one to trust. Qortal's wiki also warns about scammers who approach people in private messages.

Also asked as: buy qort from someone directly · private qort deal · send ltc to someone for qort · otc qort trade · someone offers to sell me qort

## Q: Where can I see recent QORT trades?

A: Qortino has no live prices, but Q-Trade does: Trade History, Historic Trades lists the latest completed trades for the coin selected, with the price per QORT, and QORT for sale shows the current sell orders sorted by price. For charts, open the Q-Charts Q-App.

Also asked as: recent qort trades · qortal market data · see qort trades q-trade · last trade price qort · qort trading activity

## Q: Should I buy or sell QORT right now?

A: Qortino can't tell you when to buy or sell: it gives no investment advice and sees no live prices offline. For the current market, look at the sell orders and Historic Trades in Q-Trade, or the charts in Q-Charts, and decide for yourself.

Also asked as: should i buy qort now · should i sell qort now · good time to buy qort · best time to sell qort · buy qort today

## Q: Is QORT listed on any exchange?

A: qortal.dev says QORT is listed on NonKYC.io, a centralized exchange that trades QORT against USDT without KYC. It also recommends Q-Trade for the most security, since there you trade straight from your own wallet and no exchange holds your coins.

Also asked as: qort on an exchange · nonkyc qort · buy qort on an exchange · qort usdt · centralized exchange qort · what is nonkyc

## Q: Can I trade while my node is still syncing?

A: Wait until it's fully synced. Qortal's trade guide says your node must be synced the whole time you trade, because its trade bot sends and checks each step. An unsynced node can make a trade stall until refunds start.

Also asked as: trade while syncing · node not synced q-trade · q-trade unsynced node · sync before trading · trading during sync

## Q: What do I need before I can trade on Qortal?

A: A Qortal account in Hub or GO, and something to trade: LTC (or another supported coin) in your Qortal wallet to buy QORT, or QORT to sell. You can buy on the public node; selling needs your own node, kept online and synced. Open Q-Trade with Buy on Home's Wallet Activity card.

Also asked as: requirements to trade qort · what do i need to trade qort · q-trade requirements · trade qortal beginner checklist · ready to trade qort

## Q: Where are my coins while a trade is running?

A: The seller's QORT sits in the order's AT on the Qortal chain. The buyer's coins (for example LTC) sit in a time-locked address on that coin's chain, which only the seller can claim with the trade's secret, or which the buyer can take back after the timeout. That's what makes the trade atomic.

Also asked as: where are my ltc during a trade · coins locked during trade · p2sh trade qortal · where is my qort during a trade · funds during q-trade

## Q: Why was my buy refunded?

A: Common reasons: another buyer took the order first, the seller's node didn't respond in time (for example it went offline), or the seller cancelled. In each case the trade can't finish, so the coins go back after the timeout. Q-Trade hides sellers whose nodes aren't online to make this rarer.

Also asked as: buy refunded why · q-trade refunded my ltc · trade refunded reason · why did my trade fail · order refunded q-trade

## Q: Can a seller on Q-Trade cheat me?

A: Not with the trade itself: the seller can only claim your coins with the secret that you reveal when you claim the QORT, and if they never deliver, your coins come back after the timeout. On the public node, though, you do trust the trade proxy with your coin's private key.

Also asked as: can a seller scam me q-trade · q-trade trust seller · is q-trade trustless · seller take my ltc · q-trade counterparty risk · is q-trade safe

## Q: How can a shop or market stall take QORT payments?

A: Show the customer a QR code made from qortal://pay?recipient=YOUR_ADDRESS&amount=<price>: scanning it opens GO's Send QORT with your address and the amount filled in, and the customer confirms. You see the payment arrive as an alert (Payment from <name>) and in Wallet Activity, about a minute later. GO's Qortal Card test feature can also take payments by tap.

Also asked as: shop accept qort · take qort payments shop · merchant qortal payments · accept qort at my stall · qort payment for business

## Q: Can POS+ take QORT or card payments itself?

A: No. POS+ is the register: it records how each sale was paid (Card, Cash or a split of both) and makes the receipt, but it doesn't charge cards or move any QORT itself. To take QORT, a customer with GO can pay you with Send QORT, for example by scanning a qortal://pay QR code you show.

Also asked as: pos+ accept qort · pos+ crypto payments · pos+ card terminal · pay with qort at pos+ · does pos+ process payments · pos+ take qort payments

## Q: Can I send LTC to someone's Qortal name?

A: No. Qortal names point to QORT addresses only, so Q-Wallets resolves names for QORT but needs a real address for LTC and the other coins. Ask the person for their LTC address (in their Q-Wallets, Litecoin, Receive).

Also asked as: send ltc to a name · litecoin to qortal name · pay btc to registered name · send other coin to name · ltc by username

## Q: Does my trade keep going if I close Hub or GO?

A: Yes, once Q-Trade has answered, because the trade bot runs inside Qortal Core on the node, not in the app. What matters is that the node keeps running: your own Core for orders made there, or the trade proxy's node for buys on the public node. Closing Hub or GO doesn't stop it.

Also asked as: close hub during sell order · log out with open trade · does trade need hub open · sell order after closing go · trade continue app closed

## Q: Can I cancel a buy order in Q-Trade?

A: No. Once a buy is submitted, Q-Trade has no cancel for it: it either completes or, if it can't, refunds your coins after the trade's timeout. Only sell orders can be cancelled. Check the orders and the approval before you tap BUY.

Also asked as: cancel buy order q-trade · undo buy q-trade · stop a buy order · cancel my purchase qort · cancel pending buy

## Q: How do I send QORT with Q-Wallets?

A: Open Q-Wallets, pick Qortal and choose Transfer QORT. Enter a QORT address or name, or pick a contact from your address book, then the amount (Send max holds back the 0.01 QORT network fee). Hub or GO then asks you to approve the payment. Always double-check the address: payments can't be reversed.

Also asked as: send qort q-wallets · q-wallets transfer qort · pay with q-wallets · q-wallets qort send · send qort to contact q-wallets

## Q: Where do I get Litecoin to buy QORT?

A: Litecoin is sold on most crypto exchanges; qortal.dev mentions Coinbase and Binance as examples. Buy LTC there, withdraw it to your Qortal LTC address (Q-Wallets, Litecoin, Receive), then buy QORT with it in Q-Trade.

Also asked as: where to buy ltc · get litecoin for qortal · buy ltc for qort · litecoin exchange for qortal · how to get ltc · how to get litecoin

## Q: What is ARRR (Pirate Chain) in Qortal?

A: ARRR is the coin of Pirate Chain, a privacy-focused blockchain whose shielded addresses start with zs. Every Qortal account has an ARRR wallet next to its QORT, and ARRR can be traded for QORT in Q-Trade. Its wallet only works with your own node, because the node needs your ARRR seed to read or send it.

Also asked as: what is arrr · pirate chain qortal · arrr coin qortal · what is pirate chain · arrr privacy coin

## Q: What does "the node asked for a fee ... Nothing was sent" mean?

A: Just before signing, Hub and GO fetch the fee again. If the node now asks for more than the fee you saw, or more than 1 QORT, they stop and send nothing. Try again; if the higher fee keeps appearing, the node may be misbehaving, so consider using another node.

Also asked as: node asked for a fee more than you approved · fee above approved nothing was sent · fee above limit qortal · payment refused higher fee · nothing was sent fee error

## Q: What does "could not confirm whether this transfer was sent" mean?

A: Hub or GO sent the payment but couldn't check afterwards whether the network accepted it, so the message shows its signature. Don't send again straight away: look in Wallet Activity's Transaction history first, and only retry if the payment isn't there. The same goes when a Q-App says a payment timed out after you accepted it. Sending again blindly could pay twice.

Also asked as: could not confirm whether this transfer was sent · transfer not confirmed qort · did my qort payment go through · qort payment status unknown · not sure if qort was sent · q-app payment timed out

## Q: How many decimal places can a QORT amount have?

A: Up to 8 decimals, so the smallest amount is 0.00000001 QORT. Amounts must be plain numbers like 1.5; forms like 1e3 are refused. In payment links, write the amount with a dot, like 0.25.

Also asked as: qort decimals · smallest amount of qort · how small can a qort payment be · qort 8 decimals · minimum qort i can send

## Q: Can I add a note or message to a QORT payment?

A: Not in the payment itself: Send QORT in Hub and GO and Q-Wallets' QORT form have no note field. If the person needs to know what it's for, tell them in Q-Chat. Only ARRR sends in Q-Wallets have an optional memo, up to 40 characters.

Also asked as: qort payment memo · add message to qort payment · note with qort transfer · payment reference qort · memo field send qort

## Q: How do I send all my QORT?

A: In Q-Wallets, tap Send max: it fills in the most you can send after reserving the fee. In Hub's and GO's Send QORT, enter your balance minus the 0.01 QORT fee. If Q-Wallets says Max allowed, the amount you typed is above what you can send.

Also asked as: send max qort · empty my qort wallet · send entire qort balance · transfer all my qort · max sendable qort

## Q: Can I send QORT to an address that starts with A?

A: Yes, if it's a valid AT address. Addresses starting with A belong to ATs, Qortal's automated accounts such as a crowdfund, and Hub and GO accept them as payment recipients. Normal accounts start with Q.

Also asked as: send qort to at address · pay a crowdfund address qort · send qort to an a address · qort payment to at · pay q-fund address

## Q: Why did a green name appear next to To in Send QORT?

A: When the address you scan or type has a registered name, Send QORT shows that name in green next to the To field. It helps you check you're paying the right account. No name just means that address has no registered name.

Also asked as: green name send qort · name badge to field · send qort shows a name · recipient name green qortal go · name next to address when paying

## Q: Why does a payment alert show an address instead of a name?

A: The payer's address has no registered name, or GO couldn't look the name up in time. Then the alert shows a shortened address and the Q-Wallets icon instead of a name and avatar. The payment itself is the same either way.

Also asked as: payment alert shows address · payment notification no name · unknown payer qortal go · payment from address not name · who paid me qortal go

## Q: Can I turn off payment alerts in Qortal GO?

A: There's no switch for payments alone. The Disable all push notifications switch in the bell panel turns off all of GO's push alerts, payments included. Payments still appear in the bell and in Wallet Activity.

Also asked as: turn off payment notifications · disable payment alerts go · stop qort received alerts · mute payment notification · payment alerts off

## Q: Do I get an alert when I send QORT?

A: No. Payment alerts are for QORT coming in to the account you're logged in to. For payments you send, check the Wallet Activity card or its Transaction history.

Also asked as: alert for sent qort · notification when i send qort · outgoing payment notification · sent payment alert go · notified for my own qort payment

## Q: Does Qortal Hub warn me about private keys when Core runs on the same computer?

A: No. On the desktop, a node at 127.0.0.1 is the Core you run next to Hub, so Hub sends the key to it without the extra warning. A remote node needs an encrypted connection and a tick-box warning that names the host, and a public node is always blocked.

Also asked as: hub local core private key warning · desktop trade no warning · qortal hub local node key · hub 127.0.0.1 trade · does hub send ltc key to core

## Q: Why does a Q-App ask to use my ARRR wallet while it is open?

A: Reading your ARRR wallet (address, balance, transactions, sync status) needs the ARRR seed on your node. So the first time a Q-App such as Q-Wallets does it in a tab, Hub or GO asks whether to allow this app to use your ARRR wallet while it is open, with the node warning and a tick box. One yes covers that tab, app, account and node until the tab closes.

Also asked as: allow this app to use your arrr wallet · arrr wallet permission · q-wallets arrr approval · arrr seed warning q-app · why approve arrr wallet

## Q: What does "failed to synchronize after 36 attempts" mean?

A: Your node's ARRR (Pirate Chain) wallet hadn't finished syncing, and Hub or GO gave up waiting after 36 tries. Wait a little and try again. Q-Wallets shows the ARRR sync status and lets you change the lightwallet server if it can't connect.

Also asked as: failed to synchronize after 36 attempts · arrr sync failed · pirate chain not synchronized · arrr wallet syncing error · arrr synchronization error

## Q: What are Pirate Chain lightwallet servers in Q-Wallets?

A: Your node's ARRR wallet reaches Pirate Chain through a lightwallet server. Q-Wallets shows the current server and a list of available Pirate Chain lightwallet servers, and you can switch if one isn't working. No Connection To Pirate Chain Lightwallet Server means the node can't reach one.

Also asked as: pirate chain lightwallet server · arrr server q-wallets · no connection to pirate chain lightwallet server · change arrr server · arrr lightwallet

## Q: What does a Pirate Chain (ARRR) address look like?

A: Your ARRR address is a shielded address: 78 characters starting with zs. ARRR sends from Q-Wallets can carry an optional memo of up to 40 characters. Like the other coins, ARRR has its own address, separate from your QORT address.

Also asked as: arrr address format · pirate chain address zs · arrr memo length · shielded arrr address · what is a zs address

## Q: Which Bitcoin addresses can I send to from Q-Wallets?

A: Legacy addresses (starting with 1), SegWit (starting with 3) and Bech32 (starting with bc1). Q-Wallets checks the format before sending. Bitcoin's network fees are much higher than Litecoin's, so look at the fee before you send.

Also asked as: btc address types q-wallets · send bitcoin to bc1 address · bitcoin address format qortal · segwit bitcoin qortal · legacy btc address qortal

## Q: What are fee publishers in Q-Wallets and Q-Trade?

A: They're Qortal names that publish fee estimates for each coin on QDN, as low, medium and high rates per kB. Q-Trade's settings let you choose Foreign-Fee-Publisher or JSON.Bridge, and Q-Wallets also fetches estimates from decentralized publishers. If no estimate loads, you can still enter a custom fee.

Also asked as: fee publisher qortal · foreign-fee-publisher · json.bridge fees · recommended fees source q-trade · where do fee estimates come from

## Q: How many confirmations does Q-Wallets show for a transaction?

A: Q-Wallets marks a new transaction as Pending confirmation, then Pending, 1 of 3 confirmations and so on, and Confirmed once it has 3. A low fee can make another coin's transaction slow to confirm.

Also asked as: q-wallets confirmations · pending 1 of 3 confirmations · transaction pending q-wallets · ltc send pending · confirmed q-wallets

## Q: Can Qortal add more coins to its wallets and Q-Trade?

A: Each new coin needs its own native wallet built into Qortal before it can be held or traded, so additions take development work. Qortal's guidelines prefer coins with no ICO or pre-mine, a fair launch, no proof of stake and no KYC, plus technical support such as ElectrumX servers and legacy-style addresses. Listings are meant to be decided by community vote once the voting system is ready.

Also asked as: add new coin qortal · will qortal add ethereum · list my coin on q-trade · new coins trade portal · monero on qortal

## Q: How do I see the details of a transaction in Q-Wallets?

A: Open the coin in Q-Wallets and look at its transaction list: each row shows the time, sender and receiver, amount, fee and status, and you can copy the transaction hash (or signature for QORT). Unconfirmed transactions are marked until they confirm.

Also asked as: q-wallets transaction details · copy tx hash q-wallets · transaction hash qortal wallet · see fee of transaction · q-wallets transaction info

## Q: How do I filter my QORT transactions in Q-Wallets?

A: On Q-Wallets' QORT page, use the filters: Payments, Rewards (reward shares and related), Arbitrary (QDN publishes), AT, Group, Name, Asset and Poll, or All. Trade activity such as sell order contracts and their messages appears under AT, while Hub's and GO's Transaction history lists only payments.

Also asked as: filter transactions q-wallets · q-wallets payments filter · see trade transactions qort · q-wallets at filter · q-wallets transaction types

## Q: What does "Invalid LTC address" mean in Q-Wallets?

A: The text in the address field doesn't match a Litecoin address format, so Q-Wallets won't send to it. Check you copied an LTC address (L, M or ltc1) completely and not another coin's address. Each coin shows a similar message for its own address type.

Also asked as: invalid ltc address · q-wallets invalid address · ltc address rejected · invalid btc address q-wallets · address format error q-wallets

## Q: Why does a payment say the name contains invisible characters?

A: The recipient name includes hidden characters, which can make a look-alike name pass for a real one, so Hub, GO and Q-Wallets refuse to pay it. Check where the name came from, and pay the address you know instead.

Also asked as: name contains invisible characters · invisible characters qortal name · payment refused hidden characters · qortal names containing invisible characters · fake name payment

## Q: Can I keep QORT in a cold wallet?

A: Qortal's wiki describes a simple cold wallet: create an account on a device that isn't connected to the network, save its backup file to a USB stick (more than one copy is better), write down the address, then close the app. Send a small amount first to check it arrives, then send QORT to that address whenever you like.

Also asked as: qort cold wallet · offline wallet qortal · cold storage qort · store qort offline · qortal paper wallet

## Q: What's the difference between Q-Wallets and the Wallet Activity card?

A: Wallet Activity is the quick QORT card on Home, with Send, Receive and Buy and your latest QORT payment. In Hub 3.0.3 it shows only that one payment, from the past 7 days, so it is not a history; in GO, a Transaction history row under it lists your payments, 20 at a time. Q-Wallets is the full multi-coin wallet app, with balances and history for every coin, sending, QR codes, address books and fee choices.

Also asked as: q-wallets vs wallet activity · wallet activity or q-wallets · which wallet to use qortal · difference wallets app home card · qortal wallet options

## Q: Does Q-Trade have Auto Buy?

A: No. Auto Buy was a tool in the old Qortal UI's Trade Portal. In Q-Trade you tick several sell orders yourself and buy them in one go.

Also asked as: auto buy q-trade · autobuy qortal · automatic buy qort · auto buy trade portal · set and forget buy qort

## Q: What is the locking fee?

A: The locking fee is the network fee rate (per kB) for the transaction that locks your coins at the start of a buy. Hub and GO show the total unlocking fee and the locking fee rate in the buy approval. On your own node, Q-Trade's settings gear can set a custom locking fee; otherwise it follows your unlocking fee.

Also asked as: locking fee meaning · total locking fee · locking fee q-trade · custom locking fee · lock fee per kb

## Q: Why don't I see the Fee button in Q-Trade?

A: Q-Trade only shows the Fee button, the unsigned fees warning and the settings gear when you use your own node, because they change settings on that node. On the public node the node's own fee is used as it is. ARRR orders have no unlocking fee, so there's no Fee button for ARRR.

Also asked as: no fee button q-trade · q-trade fee missing · where is the fee setting q-trade · q-trade settings gear missing · fee button public node

## Q: Q-Trade suggests lowering my unlocking fee. Should I?

A: The Suggestion appears when your fee is higher than any of your chosen orders needs. Lower fee sets it to the highest fee those orders require, which costs less and still meets every order; Continue without updating keeps your current fee. Either way the buy goes ahead.

Also asked as: lower fee suggestion q-trade · unlocking fee higher than necessary · q-trade suggestion lower fee · continue without updating fee · reduce q-trade fee

## Q: Why are small trades with BTC expensive?

A: Bitcoin's network fees are high, and a trade needs several transactions on the BTC chain, so the fees can be large next to a small order. Qortal's wiki suggests using BTC for larger purchases. Litecoin's fees are very low, and the LTC market has the most activity, which is why most people trade QORT with LTC.

Also asked as: btc trade fees high · buy qort with bitcoin fees · bitcoin small order expensive · btc vs ltc fees trade · why use ltc to buy qort

## Q: Why does buying on the public node take up to 3 minutes?

A: On the public node your buy goes to the Qortal trade proxy as an encrypted message, and Q-Trade waits for its answer, so it shows Using gateway: might take up to 3 minutes to submit the buy order, with a countdown. On your own node the order goes straight to your node's trade bot.

Also asked as: q-trade 3 minutes · using gateway might take up to 3 minutes · buy order slow public node · q-trade countdown · gateway buy order wait

## Q: What does the "Is using Gateway" switch in Q-Trade mean?

A: It shows whether Q-Trade runs through a public node (a gateway). You can't flip it inside Q-Trade: change the node in Hub or GO instead (in GO: avatar menu, Node, then Private node). With your own node you also get selling, the Fee button and the settings gear.

Also asked as: is using gateway q-trade · q-trade gateway switch · change node q-trade · q-trade local node · gateway toggle q-trade

## Q: Do I lose anything when a trade is refunded?

A: A little: the other coin's network fees for locking and refunding are spent even when a trade fails, and QORT transaction fees aren't returned. The traded amount itself comes back to you. With LTC these fees are very small.

Also asked as: refund fee loss · lose ltc on failed trade · failed trade cost · refund minus fee · do refunds cost fees

## Q: Why can't I press BUY in Q-Trade?

A: BUY stays grey until you tick at least one order. If an order won't tick, its unlocking fee is higher than your node's fee. If BUY works but you get a balance error, your coin balance is too low or hasn't loaded yet.

Also asked as: buy button grey q-trade · q-trade buy disabled · cant click buy q-trade · buy button not working q-trade · select order to buy

## Q: Can Q-Trade send the QORT I buy to another account?

A: No. A buy always delivers the QORT to the account you're logged in to. Once it arrives, send it on with Send QORT if it's meant for someone else.

Also asked as: buy qort for someone else · q-trade receiving address · send bought qort to friend · buy qort to another address · q-trade buy for another account

## Q: Do I get the fee back when I cancel a sell order?

A: No. Cancelling sends a small QORT transaction, shown in the approval, and neither that fee nor the fee for creating the order comes back. The QORT you listed returns to your balance.

Also asked as: cancel sell order fee · fee refunded after cancel · cancel order cost qort · lose fee cancelling order · sell order cancel fee

## Q: Can I trade LTC for BTC directly on Q-Trade?

A: No. Every Q-Trade pair has QORT on one side (QORT-LTC, QORT-BTC and so on). To go from LTC to BTC you'd buy QORT with LTC, then sell that QORT for BTC.

Also asked as: ltc to btc q-trade · trade btc for ltc qortal · swap doge for ltc qortal · direct coin swap qortal · qort base pair

## Q: What is the trade timeout?

A: It's how long a trade may take before refunds can start. Sell orders made in Hub and GO use 2 hours, set when the order is created. If a buyer's trade hasn't finished in time, the buyer's locked coins can be refunded and the AT's QORT goes back to the seller.

Also asked as: trade timeout qortal · how long before a trade refunds · q-trade time limit · trade expires · 120 minute trade timeout

## Q: Do sell orders expire?

A: No. A sell order stays open until someone buys it or you cancel it. It's only hidden from buyers while your node isn't online to announce it, and then it shows under Stuck orders.

Also asked as: sell order expire · how long does a sell order last · sell order time limit · order still open after days · old sell order q-trade

## Q: Can I change the price of my sell order?

A: Not directly: Q-Trade has no edit for sell orders. Cancel the order (your QORT comes back after a couple of minutes), then create a new one at the new price. Each step costs a small QORT fee.

Also asked as: change sell order price · edit sell order q-trade · reprice qort order · update my sell price · lower price sell order

## Q: Why did my balance drop by more than my sell order amount?

A: A sell order puts the order amount plus 0.01 QORT into its AT, to cover the AT's own running costs, and the approval shows the transaction fee on top. So listing 10 QORT takes a little more than 10 from your balance.

Also asked as: balance dropped more than order · extra qort sell order · sell order costs more qort · qort missing after listing · at funding fee

## Q: Why are there few or no sell orders for some coins?

A: Orders only appear when people list QORT for that coin, and Q-Trade only shows sellers whose node is online. Litecoin usually has the most orders; other coins can be quiet. Pick another coin in the selector or check again later.

Also asked as: no sell orders q-trade · no doge orders · empty order book q-trade · few qort sellers · no arrr orders

## Q: Where can I get help with a trade problem?

A: Ask in Q-Chat, for example in the Qortal Project group, Qortal's official community group for news and support, or report it with the Q-Support Q-App. Say which coin, roughly when, and what My Pending Orders or your sell list shows. Never share your seed phrase, private key or backup password with anyone helping you.

Also asked as: help with stuck trade · qortal trade support · ask about failed trade · trade problem help · q-trade support

## Q: What does Q-Trade's settings gear do?

A: On your own node, the gear next to Terms and conditions opens Q-Trade's settings. Locking fees: tick Enable custom locking fee to set the locking fee rate (sats per kB) separately, then Update locking fee. Fee publisher: choose where recommended fees come from, Foreign-Fee-Publisher or JSON.Bridge.

Also asked as: q-trade settings · q-trade gear icon · custom locking fee setting · q-trade fee publisher setting · enable custom locking fee

## Q: What are sats in Q-Trade's fees?

A: A sat is a coin's smallest unit: 100,000,000 sats make 1 LTC (and likewise 1 BTC or 1 DOGE). So an unlocking fee shown as 30000 sats is 0.0003 LTC per order.

Also asked as: sats meaning q-trade · what is a sat · fee in sats · sats to ltc · unlocking fee sats

## Q: How do I switch coins in Q-Trade?

A: Use the coin selector under the balance card: LTC, DOGE, BTC, DGB, RVN or ARRR. The order list, your pending orders, balances and history all follow the coin you pick. Q-Trade starts on LTC.

Also asked as: change coin q-trade · q-trade coin selector · switch to doge in q-trade · select btc in q-trade · switch to arrr q-trade

## Q: How do I send QORT from Q-Trade?

A: On Q-Trade's Total Balance card, tap Send under your QORT balance, enter a Recipient Address or Name and the Amount, then tap Send and approve the payment in Hub or GO. Receive under the QORT balance shows your QORT address and its QR code.

Also asked as: send qort in q-trade · q-trade send button qort · transfer qort q-trade · q-trade total balance send · pay from q-trade

## Q: What do the LTC/QORT and Total LTC Value columns mean in Q-Trade?

A: LTC/QORT is the price per QORT in LTC (the order's total divided by its QORT amount), and Q-Trade sorts by it, lowest first. Total LTC Value is what the whole order costs before your unlocking fee. QORT AMOUNT is how much QORT the order sells, and Seller shows the seller's name or address.

Also asked as: q-trade columns · ltc per qort column · total ltc value meaning · qort amount column · q-trade order table

## Q: How do I see a sell order's details before buying?

A: Tap the info icon at the start of the order's row. Q-Trade shows the seller, the amount, the total, the price per QORT, the unlocking fee in sats and the order's AT address, with copy buttons. A red box warns you if your node's unlocking fee is too low for that order.

Also asked as: sell order details q-trade · info icon q-trade · order info q-trade · see the seller of an order · at address of an order

## Q: Why does QORT's dollar value change when its LTC rate doesn't?

A: QORT has no direct dollar price: it trades against coins like LTC, so any dollar value is indirect. If LTC's dollar price falls while trades stay at the same LTC rate, QORT's dollar value falls with it. It can also look different against BTC than against LTC.

Also asked as: qort dollar value changes · qort indirect value · qort usd value ltc · why did qort value drop · qort value in dollars

## Q: How do I choose a price for my sell order?

A: You can set any price: there are no walls, and buyers pick whichever orders suit them. Qortino can't advise on prices and has no live data, but Q-Trade's open sell orders and Historic Trades show what others ask and recently traded at. For BTC, Qortal's wiki reminds sellers that buyers also pay high network fees, which matters for small orders.

Also asked as: what price to sell qort · set sell price q-trade · price for my sell order · how much to sell qort for · sell order price advice

## Q: Who can see my trades?

A: Anyone: trades happen on public blockchains, and Q-Trade's Historic Trades lists recent trades with the buyer's and seller's names or addresses. The other coin's side is visible on its own chain too.

Also asked as: are qortal trades private · is trade history public · q-trade privacy · anonymous trading qortal · can others see my q-trade trades

## Q: What does "Allow this app to perform a sell order?" show?

A: It shows the order as the QORT amount for the coin amount, with the QORT fee and a tick box to confirm you've read it. For ARRR it also warns that your ARRR seed goes to your node. Accepting creates the order's AT on the chain.

Also asked as: allow this app to perform a sell order · sell order approval · approve sell order · sell order permission q-trade · sell approval window

## Q: What does "Allow this app to cancel a sell order?" mean?

A: Q-Trade is asking to cancel one of your sell orders, shown by its QORT and coin amounts, for a small QORT fee. Accepting sends a message to the order's AT that cancels it and returns your QORT. Decline if you didn't ask to cancel.

Also asked as: allow this app to cancel a sell order · cancel sell order approval · cancel sell order permission · approve cancel sell · cancel sell fee approval

## Q: What does "Allow this app to update foreign fees on your node?" mean?

A: Q-Trade wants to change your node's fee setting for a coin, such as the unlocking fee you picked with the Fee button or a custom locking fee. It only works on your own node and changes what your future trades use. Decline if you didn't ask for it.

Also asked as: update foreign fees on your node · foreign fee permission · q-trade fee approval · allow update fee node · change node fee approval

## Q: Is Q-Trade a decentralized exchange (DEX)?

A: Yes: trades happen directly between the two people's nodes, and nobody takes control of the coins at any point. A trade either succeeds or fails, in which case each side gets their coins back. Qortal prefers the name Trade Portal because DEX is used loosely elsewhere.

Also asked as: is q-trade a dex · decentralized exchange qortal · qortal dex · trade portal dex · peer to peer exchange qortal

## Q: How do I buy QORT with ARRR?

A: You need your own node, because the ARRR wallet and its balance need your ARRR seed on the node. Pick ARRR in Q-Trade's coin selector, tick one sell order (ARRR orders are bought one at a time and have no unlocking fee) and tap BUY, then accept the approval with its ARRR seed warning.

Also asked as: buy qort with arrr · pirate chain to qort · arrr buy order q-trade · trade arrr for qort · buy qort pirate chain

## Q: What if the seller cancels while I'm buying their order?

A: Your buy can't complete, so your trade bot refunds your locked coins once the trade's timeout has passed. The order then ends as failed or refunded rather than completed, and you lose only the other coin's network fees.

Also asked as: seller cancelled during my buy · order cancelled while buying · seller cancel refund · buy failed seller cancelled · at cancelled refund

## Q: What are Q-Trade's terms and conditions?

A: In short: Q-Trade aims to make trading LTC and other coins for QORT easy, its maintainers don't profit and there are no extra fees, and it's a hobby project whose developers aren't responsible for lost coins. It explains that the gateway (public node) means trusting that node with your coin's private key, and offers your local node instead. Read them with Terms and conditions at the top of Q-Trade.

Also asked as: q-trade terms · q-trade terms and conditions · q-trade disclaimer · who is responsible q-trade · q-trade hobby project

## Q: What's the difference between the QORT for sale and Sell QORT tabs?

A: QORT for sale is where you buy: it shows My Pending Orders and other people's Open Market Sell Orders. Sell QORT is for your own sell orders: New Sell Order, Stuck orders and your listed orders with Cancel sell order. Trade History is the third tab.

Also asked as: qort for sale tab · sell qort tab · q-trade tabs · buy tab q-trade · where to buy in q-trade

## Q: Why don't my pending Q-Trade orders show on my other device?

A: Q-Trade keeps My Pending Orders on the device you bought from, and only for the last day. On another device the list starts empty, but finished trades show under Trade History, My Buy History on any device.

Also asked as: pending orders other device · q-trade orders missing on phone · my pending orders empty · q-trade different device · pending order not synced

## Q: Does POS+ cost anything to use?

A: POS+ needs no separate server, subscription or cloud account. What you do pay is the small QORT fee for each QDN publish you approve, such as closing the day, saving products or settings, or sharing a clock-in. Turning off live clock-in sharing means fewer publishes to approve.

Also asked as: pos+ cost · is pos+ free · pos+ subscription · pos+ fees · pos+ monthly fee

## Q: POS+ didn't open my store automatically. What should I check?

A: Make sure Keep me signed in on this device is ticked, and approve Hub's or GO's request to share your account, accepting if it offers to remember the choice. If Hub or GO is signed in to a different account, POS+ asks you to choose the store.

Also asked as: pos+ not opening store · pos+ keep me signed in · pos+ asks to sign in again · pos+ auto open store · pos+ login every time

## Q: Q-Wallets says my ARRR wallet is "Not initialized yet". What does that mean?

A: Your node is still setting up and syncing your Pirate Chain wallet, so Q-Wallets can't show the address or balance yet. Keep your own node running and check again later; if it can't reach a server, try another Pirate Chain lightwallet server in Q-Wallets.

Also asked as: arrr not initialized yet · initializing wallet arrr · q-wallets arrr not ready · pirate chain wallet initializing · arrr wallet not loading

## Q: Which address formats do DOGE, DGB and RVN use in Q-Wallets?

A: Dogecoin: 34 characters starting with D. DigiByte: 34 characters starting with D or S, or 43 starting with dgb1. Ravencoin: 34 characters starting with R. Q-Wallets checks these formats before it sends.

Also asked as: doge address format · dgb address format · rvn address format · dogecoin address qortal · ravencoin address qortal

## Q: What does "invalid amount" mean when I send QORT?

A: Send QORT only accepts a plain number above zero with at most 8 decimals, such as 2.5. It refuses zero, negative numbers, more than 8 decimals and forms like 1e3. If it says please enter an amount greater than 0 or please enter a recipient, fill in that field first.

Also asked as: invalid amount send qort · qort amount not accepted · please enter an amount greater than 0 · send qort amount error · too many decimals qort

## Q: What does "Allow this app to set the current server?" mean?

A: A Q-App such as Q-Wallets wants to change which server your node uses for a coin, for example a Pirate Chain lightwallet server; the window shows the coin, the server type and its host. It only works on your own node: on the public node you get This action cannot be done through a public node.

Also asked as: allow this app to set the current server · change coin server approval · set current server q-wallets · this action cannot be done through a public node · foreign server permission

## Q: Can I speed up a slow trade?

A: Not once it's running: the trade bots have to wait for each confirmation, or for the timeout if something stalls. For later trades, a higher fee (Medium or High with the Fee button on your own node) helps the other coin's transactions confirm sooner, since confirmation speed depends on the fee.

Also asked as: speed up trade · trade too slow q-trade · faster trade qortal · raise fee during trade · make trade faster

## Q: How do I find the cheapest QORT on Q-Trade?

A: Q-Trade sorts Open Market Sell Orders by LTC/QORT (price per QORT), lowest first, so the cheapest orders are at the top; tap the column header to sort the other way. Remember each order you buy adds an unlocking fee, so many tiny orders can cost more in total than one bigger one.

Also asked as: cheapest qort q-trade · lowest price sell order · best price qort order · sort orders by price q-trade · find low price qort

## Q: Why does buying many small orders cost more?

A: Q-Trade adds your unlocking fee once for every order you tick, so ten small orders pay ten unlocking fees while one big order pays one. The bottom bar shows the total with unlocking fees, so compare it before you tap BUY.

Also asked as: many small orders fees · unlocking fee per order · small orders expensive q-trade · fees add up q-trade · buy one big order or many small

## Q: Why doesn't my QORT balance update right away in Q-Wallets?

A: Q-Wallets refreshes the QORT balance on its own about every 2.5 minutes, and a payment only counts once it's confirmed in a block. Use the refresh button to update it sooner.

Also asked as: q-wallets balance not updating · q-wallets refresh balance · balance late q-wallets · q-wallets qort balance old · refresh q-wallets

## Q: What is QORT's market cap or trading volume?

A: Qortino runs offline, so it has no live market figures and won't guess them. Q-Charts charts QORT's past trades and shows each day's volume when you hover a candle, and Q-Trade's Historic Trades lists the latest trades.

Also asked as: qort market cap · qort trading volume · qort volume today · how big is the qort market · qort market size

## Q: What is the smallest amount of QORT I can buy on Q-Trade?

A: There's no fixed minimum for buyers: you buy whole sell orders, so the smallest buy is the smallest order on offer. Sellers' orders must be worth more than 0.01 LTC (or the matching minimum for other coins), so you won't find orders smaller than that. Tick a few small orders to reach the amount you need.

Also asked as: minimum qort to buy · smallest qort order · buy a little qort · buy only 4 qort · small qort purchase

## Q: Can Qortal Hub scan payment QR codes?

A: No. The QR scanner in Send QORT is part of Qortal GO on phones only. In Hub, paste or type the address or registered name into Send QORT. qortal://pay links and payment QR codes are GO features; Hub 3.0.3 doesn't open them.

Also asked as: hub scan qr code · qr scanner qortal hub · scan payment qr desktop · hub camera qr · pay qr code on computer

## Q: Why do my other coin wallets take a moment after I log in to GO?

A: GO unlocks your QORT keys first so Home and chat are ready quickly, then works out your BTC, LTC, DOGE, DGB, RVN and ARRR wallets in the background. Coin addresses, balances and trades become ready a moment later; if Q-Wallets or Q-Trade is still loading right after login, give it a few seconds.

Also asked as: ltc wallet slow after login · btc wallet not ready go · other coins loading after unlock · foreign wallets delay go · ltc address takes time go
