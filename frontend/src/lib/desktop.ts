export const isElectron = !!window.jueman?.isElectron

export async function openOutputDir(): Promise<void> {
  if (!window.jueman) return
  const info = await window.jueman.info()
  const sep = info.platform === 'win32' ? '\\' : '/'
  const home = info.dataHome || info.userData
  await window.jueman.openPath(`${home}${sep}data${sep}output`)
}

export async function openUserData(): Promise<void> {
  if (!window.jueman) return
  const info = await window.jueman.info()
  await window.jueman.openPath(info.userData)
}
