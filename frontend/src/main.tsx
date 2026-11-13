import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import './index.css'
import { router, Bootstrap } from './app/router'
import { onSessionExpired } from './services/api'
import { useAuth } from './stores/auth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: (n, e: any) => n < 2 && ![401, 403, 404].includes(e?.response?.status), refetchOnWindowFocus: true },
  },
})

onSessionExpired(() => {
  useAuth.getState().endSession()
  queryClient.clear()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Bootstrap>
        <RouterProvider router={router} />
      </Bootstrap>
      <Toaster position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
)
