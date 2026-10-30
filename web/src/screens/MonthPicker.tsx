import { dateLabel, shiftMonth } from '../../../shared/dates';
import Icon from './Icon';
export default function MonthPicker({ month, setMonth, earliest, current }: { month: string; setMonth: (month: string) => void; earliest: string; current: string }) {
  return <div className="month-picker"><button className="icon-button" aria-label="Предыдущий месяц" title="Предыдущий месяц" disabled={month <= earliest} onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="back"/></button><span>{dateLabel(`${month}-01`, { month: 'long', year: 'numeric' }).replace(' г.', '')}</span><button className="icon-button" aria-label="Следующий месяц" title="Следующий месяц" disabled={month >= current} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="next"/></button></div>;
}
