// 生成台「案例展示」配置：不分 tab，所有案例平铺显示。
//
// source 决定展示视频从哪取：
//   'case'   → 后端 HOME/data/case/<name>/output 下的成片（成品/合成视频）
//   'latest' → 「记录」里该分组最新的一条成功成片
//
// 「复制项目」= 把该分组在记录里的全部内容（提示词、参考素材、成片）
//             复制成一份新的可编辑项目，落到「记录」里成为一个分组。

export type CaseSource = 'case' | 'latest'

export interface CaseItem {
  name: string
  source: CaseSource
}

export const CASES: CaseItem[] = [
  { name: '包大人严选', source: 'latest' },
  { name: '富士-A5', source: 'latest' },
  { name: '耳间万生', source: 'case' },
  { name: '儿时', source: 'case' },
]
