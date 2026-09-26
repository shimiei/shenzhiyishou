import type { LastMoveMark } from '../../../shared/types';

/**
 * 最后一手标记的可选项。放在这里而不是写在设置界面的 JSX 里，
 * 是因为自测要能检查"每个取值都有中文名字"：漏一个就会在设置里显示成空白按钮。
 */
export const LAST_MOVE_MARK_OPTIONS: Array<{ value: LastMoveMark; label: string }> = [
  { value: 'dot', label: '异色点' },
  { value: 'ring', label: '异色圈' },
  { value: 'redDot', label: '红点' },
  { value: 'redRing', label: '红圈' },
  { value: 'redTriangle', label: '红三角' },
  { value: 'none', label: '不标' }
];
