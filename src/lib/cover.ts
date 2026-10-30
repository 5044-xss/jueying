const GRADIENTS = [
  'linear-gradient(135deg,#dceeb1,#eef6d9)',
  'linear-gradient(135deg,#f4ecd6,#fbf7ea)',
  'linear-gradient(135deg,#c5b0f4,#e4dafb)',
  'linear-gradient(135deg,#c8e6cd,#e7f4e9)',
  'linear-gradient(135deg,#efd4d4,#faeded)',
  'linear-gradient(135deg,#f3c9b6,#fbe9e0)',
]

function hash(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  return h
}

export function coverStyle(seed: string) {
  return {
    backgroundImage: GRADIENTS[hash(seed) % GRADIENTS.length],
  } as const
}
