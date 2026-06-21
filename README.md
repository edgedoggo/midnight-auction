# Midnight Auction

A tiny Foundry VTT v11 module for running quick, dramatic auctions in DnD5e.

## Install

1. Copy the `midnight-auction` folder into your Foundry `Data/modules` folder.
2. Restart Foundry or return to setup.
3. Enable **Midnight Auction** in your world.
4. Open the floating **Midnight Auction** button in the scene UI, or run the **Midnight Auction** macro.

## Use

- GMs open the small floating gavel icon. Drag it to move it.
- The auction window preloads its current artwork before opening to avoid image resize jumps.
- Use the round tabs to move between fixed auction rounds.
- Drag items from the sidebar onto the selected round's drop bar to add lots.
- Set each lot's name, image, scene image, description, starting price, and bid increment.
- Click **Start Round**, then **Start** on a lot.
- Open **NPC Bidders** to edit 10 house bidders, or drag actors from the sidebar onto those slots. Set **Auto to** when a bidder should keep bidding up to a secret maximum price.
- Use **NPC Bid** when the room should outbid the players. Repeated NPC bids on a lot begin favoring one bidder to simulate someone really wanting it.
- Players open the floating gavel icon or the **Open Midnight Auction** macro and press the bid button.
- Each accepted bid resets the timer to 10 seconds by default.
- When the timer reaches zero, the GM client closes the lot and deducts the winning gold from the winner's assigned character.

## Settings

- **Bid Timer Mode** controls the countdown: 5, 10, 15, 30, or Sudden Death. Sudden Death starts each lot at 10 seconds and bids do not reset it.
- **Auction Rounds** controls how many fixed round tabs the GM sees, from 1 to 10. The default is 4.
- **Default Bid Increment** controls the fallback increment for items.
- **NPC Bid Increment** controls how much the GM's NPC Bid button raises the current price.
- **Scene Images** accepts up to four image paths, one per line: idle, round live, item live, sold.

Players need an assigned character with `system.currency.gp`, which matches DnD5e 2.4.x.
