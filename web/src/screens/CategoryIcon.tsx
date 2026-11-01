import { categoryEmoji } from '../../../shared/analytics';
import Icon, { type IconName } from './Icon';

const icons: Record<string, IconName> = {
  '🍔': 'groceries', '🥦': 'groceries', '☕': 'cafe', '🚗': 'transport',
  '🎁': 'gift', '💊': 'health', '🛍': 'shopping', '🎬': 'leisure',
  '📚': 'education', '⚡': 'unexpected', '📦': 'other', '•': 'other',
};

export default function CategoryIcon({ name }: { name: string }) {
  const emoji = categoryEmoji(name);
  const icon = icons[emoji.replace(/\uFE0F/g, '')];
  return icon ? <Icon name={icon}/> : <span aria-hidden="true">{emoji}</span>;
}
