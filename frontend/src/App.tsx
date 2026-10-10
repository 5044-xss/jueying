import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from './components/AppShell'
import { Toaster } from './components/ui/Toaster'
import { GeneratorPage } from './pages/Generator'
import { HistoryPage } from './pages/History'
import { SettingsPage } from './pages/Settings'
import { useUI } from './store/ui'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5000,
      refetchOnWindowFocus: false,
    },
  },
})

function Router() {
  const view = useUI((s) => s.view)
  if (view === 'settings') return <SettingsPage />
  if (view === 'history') return <HistoryPage />
  return <GeneratorPage />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell>
        <Router />
      </AppShell>
      <Toaster />
    </QueryClientProvider>
  )
}
