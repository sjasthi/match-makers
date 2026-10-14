import { View } from 'react-native';
import type { TasteSummary } from '@match-makers/shared';
import type { TasteSignal } from '@/utils/matching';

import { PersonTile, personTileGridStyle } from './PersonTile';

export type ClosestPerson = TasteSummary['closest'][number];

interface Props {
  closest: ClosestPerson[];
  /** Opens somebody's profile. The parent owns navigation, not this component. */
  onOpen: (person: ClosestPerson) => void;
}

/**
 * The people a person's answers pulled them towards, as a grid rather than a list.
 *
 * This was a ranked list, and it was the wrong shape. The deck orders by the full
 * score while this ranked by taste alone, so the two screens routinely disagreed
 * about who was first with nothing on screen to explain the gap — which made the
 * summary's claim unverifiable from the UI and the whole panel untrustworthy.
 *
 * A grid has no first place. Dropping the order removes the claim the deck could
 * contradict, and the percentage on each tile is the deck's own number so there
 * is still exactly one meaning for the word "match" in the app.
 *
 * Everyone in here has passed the same eligibility gate the deck applies, so
 * every tile is somebody the person can actually be shown. That was the real bug
 * behind the original complaint: the panel promised a consequence the deck had
 * already ruled out.
 *
 * The tile itself is `PersonTile`, shared with the deck: the two grids render
 * exactly the same card, which is the point — a person should look like a person
 * wherever the app shows them one.
 */
export function TasteMatchGrid({ closest, onOpen }: Props) {
  return (
    <View style={personTileGridStyle}>
      {closest.map((person) => (
        <PersonTile
          key={person.userId}
          userId={person.userId}
          name={person.name}
          score={person.score}
          reason={person.reason}
          onPress={() => onOpen(person)}
          testPrefix="taste-match"
        />
      ))}
    </View>
  );
}

/**
 * The signal a person carries, rebuilt from the summary entry.
 *
 * Exported because tapping a tile has to hand the detail screen something real.
 * With nothing, `ProfileDetailScreen` re-derives its breakdown from no taste at
 * all and tells the person they share nothing with whoever just sent them there.
 */
export function signalFromClosest(person: ClosestPerson): TasteSignal {
  return {
    affinity: person.affinity,
    coLikedPosts: person.coLikedPosts,
    sharedTags: person.sharedTags,
    reason: person.reason,
  };
}