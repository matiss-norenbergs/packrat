import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router-dom"
import { ThemeProvider } from "next-themes"
import { queryClient } from "@/lib/queryClient"
import { router } from "@/routes"
// Side-effect only — applies the saved accent color to <html> as soon as
// this module evaluates (before first paint), regardless of whether the
// Settings page (the only place useAccentColor's hook is actually called)
// has been visited yet.
import "@/hooks/useAccentColor"

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
