# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Pull environment variables

   ```bash
   npx eas-cli@latest env:pull --environment development --path .env
   ```

   Populates `.env` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) from the
   EAS project's `development` environment — see `CLAUDE.md` § Secrets & env for what belongs in
   `.env` and what never does.

   `--path .env` is not optional: `env:pull` defaults to writing `.env.local`, and Expo's loader
   gives `.env.local` precedence over `.env`. Leaving the default would silently shadow the `.env`
   this project documents, so a later edit to `.env` would appear to have no effect.

3. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## App assets

The app icon, splash art, and favicon are generated from versioned SVG sources in
`assets/source/`, not hand-edited as PNGs. After changing a source SVG, regenerate the PNGs
`app.json` points at:

```bash
npm run assets
```

Edit the SVGs, never the PNGs in `assets/images/` — they're build output.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
