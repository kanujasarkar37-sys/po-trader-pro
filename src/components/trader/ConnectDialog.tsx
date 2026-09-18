'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useTrader } from './store'
import { Plug, Play, Info } from 'lucide-react'

const REGIONS = [
  { id: 'api-l', label: 'Global (api-l)' },
  { id: 'api-eu', label: 'Europe (api-eu)' },
  { id: 'api-us', label: 'America (api-us)' },
  { id: 'api-msl', label: 'Asia (api-msl)' },
]

export function ConnectDialog({ children }: { children: React.ReactNode }) {
  const { connectLive, startSim, mode } = useTrader()
  const [ssid, setSsid] = useState('')
  const [region, setRegion] = useState('api-l')
  const [open, setOpen] = useState(false)

  const handleConnect = () => {
    if (!ssid.trim()) return
    connectLive(ssid.trim(), region)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Plug className="h-5 w-5 text-emerald-500" />
            Connect to Pocket Option
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Authenticate with your Pocket Option session cookie (SSID) for live & demo trading,
            or start the built-in market simulation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs text-emerald-200/90">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>How to get your SSID:</strong> log into pocketoption.com → open DevTools (F12) →
                Application → Cookies → copy the value of the <code className="rounded bg-emerald-900/40 px-1">ssid</code> cookie.
                Paste it below. It looks like <code className="rounded bg-emerald-900/40 px-1">42%5B%22auth%22…</code>
              </span>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ssid" className="text-zinc-300">SSID Cookie</Label>
            <Input
              id="ssid"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              placeholder='42%5B%22auth%22%2C%7B%22session%22%3A%22a%3A4%3A...'
              className="border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-300">Server Region</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger className="border-zinc-800 bg-zinc-900 text-zinc-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                {REGIONS.map((r) => (
                  <SelectItem key={r.id} value={r.id} className="focus:bg-zinc-800">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <RadioGroup defaultValue="demo" className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="demo" id="demo" className="border-emerald-700 text-emerald-500" />
              <Label htmlFor="demo" className="text-zinc-300">Demo account</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="real" id="real" className="border-red-700 text-red-500" />
              <Label htmlFor="real" className="text-zinc-300">Real account</Label>
            </div>
          </RadioGroup>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={handleConnect}
              disabled={!ssid.trim()}
              className="flex-1 bg-emerald-600 font-bold text-white hover:bg-emerald-500"
            >
              <Plug className="mr-2 h-4 w-4" />
              Connect Live
            </Button>
            <Button
              onClick={() => { startSim(); setOpen(false) }}
              variant="outline"
              className="flex-1 border-amber-700/60 bg-amber-950/30 font-bold text-amber-300 hover:bg-amber-900/40"
            >
              <Play className="mr-2 h-4 w-4" />
              Start Simulation
            </Button>
          </div>
          {mode === 'simulation' && (
            <Badge className="w-fit bg-amber-950/40 text-amber-300 border border-amber-800/60">
              Simulation currently active
            </Badge>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
