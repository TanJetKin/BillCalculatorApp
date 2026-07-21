# Bill Calculator

A React Native bill-splitting calculator built with Expo.

## Run

Install Node.js 20.19.x or newer, then run:

```sh
npm install
npm run start
```

Open the app with Expo Go on your phone, or press `a` for Android / `i` for iOS from the Expo terminal.

## Offline Web App

Build the installable web app:

```sh
npm run build:web
```

This creates a `dist` folder.

Deploy to GitHub Pages:

```sh
npm run deploy
```

After the first deploy, open the repository on GitHub and set Settings > Pages to serve from the `gh-pages` branch root. The app URL will be:

```text
https://TanJetKin.github.io/BillCalculatorApp/
```

On iPhone:

1. Open the hosted website in Safari.
2. Tap Share.
3. Tap Add to Home Screen.
4. Open it once while online so the app files are cached.

After that first online launch, the Home Screen app can open offline. Saved bills and groups stay on that browser/device unless Safari website data is cleared.

## What It Calculates

- Blank new bills where rows are added only when needed
- Personal costs per person
- Evenly split totals
- Specific split rows using integer shares per person
- Tax percentages based on gross amount
- Static discounts split evenly
- Fair percentage discounts based on gross amount plus tax
- Extra add-ons per person
- Net amount per person and receipt tally total
- Arithmetic in number fields, such as `1+1`, `10/2`, or `(8+2)*3`
- Copyable "who pays who" text summary
- Saved bill history on the home screen
- Autosave while editing and when returning home
- Preset people groups in a separate Groups screen
- New bill setup with bill name and blank/group start options
- Back buttons return setup, groups, and bill screens to the Bills home screen
- Left-edge swipe returns setup, groups, and bill screens to Bills home
- Sticky bill headers keep the back arrow reachable while scrolling
- Long-press history cards to select them
- Multi-select history with bulk delete and least-transfer settlement
- Installable offline web app for iPhone Home Screen use
