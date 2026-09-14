export type SurfaceEditorLocale = 'en' | 'zh'

export const SURFACE_EDITOR_COPY = {
  en: {
    preview: 'Interactive mockup preview',
    loading: 'Preparing the visible surface…',
    error: 'Surface analysis failed',
    retry: 'Retry',
    reviewLabel: 'Surface candidates',
    reviewTitle: 'Confirm the visible surface',
    reviewHint: 'Click a point to retry; Alt/Option-click excludes a neighboring part.',
    confirm: 'Use this surface',
    controls: 'Placement controls',
    toolbar: 'Drag to move · corner to resize · top handle to rotate',
    reset: 'Reset',
    chooseAnother: 'Choose another surface',
  },
  zh: {
    preview: '可交互 Mockup 预览',
    loading: '正在准备可见表面…',
    error: '表面分析失败',
    retry: '重试',
    reviewLabel: '表面候选区域',
    reviewTitle: '确认可见表面',
    reviewHint: '点击位置重试；按住 Alt/Option 点击可排除相邻区域。',
    confirm: '使用这个表面',
    controls: '位置控制',
    toolbar: '拖动移动 · 拖角缩放 · 顶部手柄旋转',
    reset: '重置',
    chooseAnother: '选择其他表面',
  },
} as const
