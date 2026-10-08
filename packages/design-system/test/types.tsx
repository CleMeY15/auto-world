import { Button, Chip, Field, SearchIcon, Skeleton } from "../src/index.js";

const button = <Button loading>Enregistrer</Button>;
const field = <Field id="search" label="Rechercher" hint="Marque ou modèle" />;
const chip = <Chip pressed={false}>Hybride</Chip>;
const icon = <SearchIcon />;
const skeleton = <Skeleton style={{ blockSize: 80 }} />;

// @ts-expect-error Field requires a stable id for label association
const fieldWithoutId = <Field label="Rechercher" />;
// @ts-expect-error Field requires a visible label
const fieldWithoutLabel = <Field id="search" />;
// @ts-expect-error Chip requires an explicit toggle state
const chipWithoutState = <Chip>Hybride</Chip>;
// @ts-expect-error icons are decorative and cannot be given an accessible label
const labelledIcon = <SearchIcon aria-label="Recherche" />;
// @ts-expect-error Skeleton content would be hidden from assistive technology
const contentSkeleton = <Skeleton>Chargement</Skeleton>;

void button;
void field;
void chip;
void icon;
void skeleton;
void fieldWithoutId;
void fieldWithoutLabel;
void chipWithoutState;
void labelledIcon;
void contentSkeleton;
