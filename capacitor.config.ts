import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.istocks.app',
  appName: 'iStocks',
  webDir: 'public',
  server: {
    url: 'https://www.istocks.codes',
    cleartext: false,
    // Keep OAuth and auth redirects inside WebView so login state is preserved in-app.
    allowNavigation: [
      'www.istocks.codes',
      '*.istocks.codes',
      'accounts.google.com',
      'oauth2.googleapis.com',
      'www.googleapis.com',
      'apis.google.com',
      'ssl.gstatic.com',
      '*.gstatic.com',
      '*.googleusercontent.com',
    ],
  },
}

export default config
