import { createApp } from 'vue'
import { clerkPlugin } from '@clerk/vue'
import './style.css'
import App from './App.vue'
import i18n from './locales/i18n'
import router from './router'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing Publishable Key')
}

const app = createApp(App)
app.use(clerkPlugin, {
  publishableKey: PUBLISHABLE_KEY
})
app.use(i18n)
app.use(router)
app.mount('#app')
