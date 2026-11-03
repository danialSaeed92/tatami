import { cap } from '../lib/format.js';

export default function BeltBadge({ belt, small }) {
  return (
    <span className={`belt belt-${belt} ${small ? 'sm' : ''}`} title={`${cap(belt)} belt`}>
      <i />{cap(belt)}
    </span>
  );
}
