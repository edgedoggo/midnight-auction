# Midnight Auction

A tiny Foundry VTT v11 module for running quick, dramatic auctions in DnD5e.

## Install

1. Copy the `midnight-auction` folder into your Foundry `Data/modules` folder.
2. Restart Foundry or return to setup.
3. Enable **Midnight Auction** in your world.
4. As the GM, run the macro named **Midnight Auction**.

## Use

- Click **Auction Actor** to create the `Midnight Auction` actor.
- Drag items onto that actor.
- In the auction window, set each item's round, starting price, and bid increment.
- Click **Start Round**, then **Start** on a lot.
- Players open the **Midnight Auction** macro and press the bid button.
- Each accepted bid resets the timer to 10 seconds by default.
- When the timer reaches zero, the GM client closes the lot, deducts the winning gold, copies the item to the winner's character, and removes it from the auction actor.

## Settings

- **Bid Timer Seconds** controls the countdown length.
- **Default Bid Increment** controls the fallback increment for items.
- **Scene Images** accepts up to four image paths, one per line: idle, round live, item live, sold.

Players need an assigned character with `system.currency.gp`, which matches DnD5e 2.4.x.
