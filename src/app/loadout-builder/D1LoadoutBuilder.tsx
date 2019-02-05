import * as React from 'react';
import CharacterSelect from '../character-select/CharacterSelect';
import './loadout-builder.scss';
import { D1Item, D1GridNode, DimItem } from '../inventory/item-types';
import {
  ArmorTypes,
  LockedPerkHash,
  ClassTypes,
  SetType,
  PerkCombination,
  D1ItemWithNormalStats
} from './types';
import * as _ from 'lodash';
import { connect } from 'react-redux';
import { DestinyAccount } from '../accounts/destiny-account.service';
import { D1Store } from '../inventory/store-types';
import { RootState } from '../store/reducers';
import { storesSelector } from '../inventory/reducer';
import { currentAccountSelector } from '../accounts/reducer';
import { D1StoresService } from '../inventory/d1-stores.service';
import { Loading } from '../dim-ui/Loading';
import CollapsibleTitle from '../dim-ui/CollapsibleTitle';
import { t } from 'i18next';
import LoadoutDrawer from '../loadout/LoadoutDrawer';
import { getDefinitions, D1ManifestDefinitions } from '../destiny1/d1-definitions.service';
import { InventoryBuckets } from '../inventory/inventory-buckets';
import { getColor } from '../shell/dimAngularFilters.filter';
import {
  loadBucket,
  getActiveBuckets,
  loadVendorsBucket,
  mergeBuckets,
  getActiveHighestSets
} from './utils';
import LoadoutBuilderItem from './LoadoutBuilderItem';
import { getSetBucketsStep } from './calculate';
import { refreshIcon, AppIcon } from '../shell/icons';
import { produce } from 'immer';
import GeneratedSet from './GeneratedSet';
import LoadoutBuilderLockPerk from './LoadoutBuilderLockPerk';
import ExcludeItemsDropTarget from './ExcludeItemsDropTarget';
import { dimVendorService, Vendor } from '../vendors/vendor.service';
import ErrorBoundary from '../dim-ui/ErrorBoundary';
import { filterLoadoutToEquipped } from '../loadout/LoadoutPopup';

interface StoreProps {
  account: DestinyAccount;
  stores: D1Store[];
  buckets?: InventoryBuckets;
}

type Props = StoreProps;

function mapStateToProps(state: RootState): StoreProps {
  return {
    account: currentAccountSelector(state)!,
    buckets: state.inventory.buckets,
    stores: storesSelector(state) as D1Store[]
  };
}

interface State {
  defs?: D1ManifestDefinitions;
  selectedCharacter?: D1Store;
  excludeditems: D1Item[];
  lockedperks: { [armorType in ArmorTypes]: LockedPerkHash };
  activesets: string;
  type: ArmorTypes;
  scaleType: 'base' | 'scaled';
  progress: number;
  fullMode: boolean;
  includeVendors: boolean;
  showHelp: boolean;
  showAdvanced: boolean;
  allSetTiers: string[];
  highestsets: { [setHash: number]: SetType };
  activePerks: PerkCombination;
  lockeditems: { [armorType in ArmorTypes]: D1ItemWithNormalStats | null };
  vendors?: {
    [vendorHash: number]: Vendor;
  };
  loadingVendors: boolean;
}

class D1LoadoutBuilder extends React.Component<Props, State> {
  state: State = {
    activesets: '5/5/2',
    type: 'Helmet',
    scaleType: 'scaled',
    progress: 0,
    fullMode: false,
    includeVendors: false,
    showAdvanced: false,
    showHelp: false,
    loadingVendors: false,
    allSetTiers: [],
    highestsets: {},
    activePerks: {
      Helmet: [],
      Gauntlets: [],
      Chest: [],
      Leg: [],
      ClassItem: [],
      Artifact: [],
      Ghost: []
    },
    excludeditems: [],
    lockeditems: {
      Helmet: null,
      Gauntlets: null,
      Chest: null,
      Leg: null,
      ClassItem: null,
      Artifact: null,
      Ghost: null
    },
    lockedperks: {
      Helmet: {},
      Gauntlets: {},
      Chest: {},
      Leg: {},
      ClassItem: {},
      Artifact: {},
      Ghost: {}
    }
  };

  private cancelToken: { cancelled: boolean } = {
    cancelled: false
  };

  componentDidMount() {
    if (!this.props.stores.length) {
      D1StoresService.getStoresStream(this.props.account);
    }

    getDefinitions().then((defs) => this.setState({ defs }));
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (prevProps.stores.length === 0 && this.props.stores.length > 0) {
      // Exclude felwinters if we have them, but only the first time stores load
      const felwinters = _.flatMap(this.props.stores, (store) =>
        store.items.filter((i) => i.hash === 2672107540)
      );
      if (felwinters.length) {
        this.setState({
          excludeditems: _.uniqBy([...this.state.excludeditems, ...felwinters], (i) => i.id)
        });
      }
    }

    // TODO: replace progress with state field (calculating/done)
    if (this.state.defs && this.props.stores.length && !this.state.progress) {
      this.calculateSets();
    }

    if (this.state.includeVendors && !this.state.vendors && !this.state.loadingVendors) {
      this.setState({ loadingVendors: true });
      dimVendorService.getVendorsStream(this.props.account).subscribe(([_, vendors]) => {
        this.setState({ vendors, loadingVendors: false });
        dimVendorService.requestRatings();
      });
    }

    if (!prevState.vendors && this.state.vendors) {
      const felwinters = _.flatMap(this.state.vendors, (vendor) =>
        vendor.allItems.filter((i) => i.item.hash === 2672107540)
      );
      if (felwinters.length) {
        this.setState({
          excludeditems: _.uniqBy(
            [...this.state.excludeditems, ...felwinters.map((si) => si.item)],
            (i) => i.id
          )
        });
      }
    }
  }

  render() {
    const { stores, buckets } = this.props;
    const {
      includeVendors,
      loadingVendors,
      defs,
      type,
      excludeditems,
      progress,
      allSetTiers,
      activesets,
      fullMode,
      scaleType,
      showAdvanced,
      showHelp,
      lockeditems,
      lockedperks,
      highestsets,
      vendors
    } = this.state;

    if (!stores.length || !buckets || !defs) {
      return <Loading />;
    }

    const active = this.getSelectedCharacter();

    const i18nItemNames: { [key: string]: string } = _.zipObject(
      ['Helmet', 'Gauntlets', 'Chest', 'Leg', 'ClassItem', 'Artifact', 'Ghost'],
      [45, 46, 47, 48, 49, 38, 39].map((key) => defs.ItemCategory.get(key).title)
    );

    // Armor of each type on a particular character
    // TODO: don't even need to load this much!
    let bucket = loadBucket(active, stores as D1Store[]);
    if (includeVendors) {
      bucket = mergeBuckets(bucket, loadVendorsBucket(active, vendors));
    }

    const activePerks = this.calculateActivePerks(active);
    const hasSets = allSetTiers.length > 0;

    const activeHighestSets = getActiveHighestSets(highestsets, activesets);

    return (
      <div className="loadout-builder dim-page itemQuality">
        <CharacterSelect
          selectedStore={active}
          stores={stores}
          onCharacterChanged={this.onSelectedChange}
        />
        <LoadoutDrawer />
        <CollapsibleTitle
          defaultCollapsed={true}
          sectionId="lb1-classitems"
          title={t('LB.ShowGear', { class: active.className })}
        >
          <div className="section all-armor">
            {/* TODO: break into its own component */}
            <span>{t('Bucket.Armor')}</span>:{' '}
            <select name="type" value={type} onChange={this.onChange}>
              {_.map(i18nItemNames, (name, type) => (
                <option key={type} value={type}>
                  {name}
                </option>
              ))}
            </select>
            <label>
              <input
                className="vendor-checkbox"
                type="checkbox"
                name="includeVendors"
                checked={includeVendors}
                onChange={this.onIncludeVendorsChange}
              />{' '}
              {t('LB.Vendor')}{' '}
              {loadingVendors && <AppIcon icon={refreshIcon} className="fa-spin" />}
            </label>
            <div className="loadout-builder-section">
              {_.sortBy(
                bucket[type].filter((i) => i.primStat!.value >= 280),
                (i) => -i.quality!.min
              ).map((item) => (
                <div key={item.index} className="item-container">
                  <div className="item-stats">
                    {item.stats!.map((stat) => (
                      <div
                        key={stat.id}
                        style={getColor(
                          item.normalStats![stat.statHash].qualityPercentage,
                          'color'
                        )}
                      >
                        {item.normalStats![stat.statHash].scaled === 0 && <small>-</small>}
                        {item.normalStats![stat.statHash].scaled > 0 && (
                          <span>
                            <small>{item.normalStats![stat.statHash].scaled}</small>/
                            <small>{stat.split}</small>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div>
                    <LoadoutBuilderItem shiftClickCallback={this.excludeItem} item={item} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleTitle>
        <div className="section">
          <p>
            <span className="dim-button locked-button" onClick={this.lockEquipped}>
              {t('LB.LockEquipped')}
            </span>
            <span className="dim-button locked-button" onClick={this.clearLocked}>
              {t('LB.ClearLocked')}
            </span>
            <span>{t('LB.Locked')}</span> - <small>{t('LB.LockedHelp')}</small>
          </p>
          <div className="loadout-builder-section">
            {_.map(lockeditems, (lockeditem, type: ArmorTypes) => (
              <LoadoutBuilderLockPerk
                key={type}
                lockeditem={lockeditem}
                activePerks={activePerks}
                lockedPerks={lockedperks}
                type={type}
                i18nItemNames={i18nItemNames}
                onRemove={this.onRemove}
                onPerkLocked={this.onPerkLocked}
                onItemLocked={this.onItemLocked}
              />
            ))}
          </div>
        </div>
        <div className="section" ng-show="excludeditems.length">
          <p>
            <span>{t('LB.Exclude')}</span> - <small>{t('LB.ExcludeHelp')}</small>
          </p>
          <div className="loadout-builder-section">
            <ExcludeItemsDropTarget onExcluded={this.excludeItem} className="excluded-container">
              <div className="excluded-items">
                {excludeditems.map((excludeditem) => (
                  <div key={excludeditem.index} className="excluded-item">
                    <LoadoutBuilderItem item={excludeditem} />
                    <div
                      className="close"
                      onClick={() => this.onExcludedRemove(excludeditem)}
                      role="button"
                      tabIndex={0}
                    />
                  </div>
                ))}
              </div>
            </ExcludeItemsDropTarget>
          </div>
        </div>
        {progress >= 1 && hasSets && (
          <div className="section">
            {t('LB.FilterSets')} ({t('Stats.Intellect')}/{t('Stats.Discipline')}/
            {t('Stats.Strength')}):{' '}
            <select name="activesets" onChange={this.onActiveSetsChange} value={activesets}>
              {allSetTiers.map((val) => (
                <option key={val} disabled={val.charAt(0) === '-'} value={val}>
                  {val}
                </option>
              ))}
            </select>{' '}
            <span className="dim-button" onClick={this.toggleShowAdvanced}>
              {t('LB.AdvancedOptions')}
            </span>{' '}
            <span className="dim-button" onClick={this.toggleShowHelp}>
              {t('LB.Help.Help')}
            </span>
            <span>
              {showAdvanced && (
                <div>
                  <p>
                    <label>
                      <select
                        name="fullMode"
                        onChange={this.onFullModeChanged}
                        value={fullMode ? 'true' : 'false'}
                      >
                        <option value="false">{t('LB.ProcessingMode.Fast')}</option>
                        <option value="true">{t('LB.ProcessingMode.Full')}</option>
                      </select>{' '}
                      <span>{t('LB.ProcessingMode.ProcessingMode')}</span>
                    </label>
                    <small>
                      {' '}
                      -{' '}
                      {fullMode ? t('LB.ProcessingMode.HelpFull') : t('LB.ProcessingMode.HelpFast')}
                    </small>
                  </p>
                  <p>
                    <label>
                      <select name="scaleType" value={scaleType} onChange={this.onChange}>
                        <option value="scaled">{t('LB.Scaled')}</option>
                        <option value="base">{t('LB.Current')}</option>
                      </select>{' '}
                      <span>{t('LB.LightMode.LightMode')}</span>
                    </label>
                    <small>
                      {' '}
                      - {scaleType === 'scaled' && t('LB.LightMode.HelpScaled')}
                      {scaleType === 'base' && t('LB.LightMode.HelpCurrent')}
                    </small>
                  </p>
                </div>
              )}
            </span>
            <span>
              {showHelp && (
                <div>
                  <ul>
                    <li>{t('LB.Help.Lock')}</li>
                    <ul>
                      <li>{t('LB.Help.NoPerk')}</li>
                      <li>{t('LB.Help.MultiPerk')}</li>
                      <li>
                        <div className="example ex-or">- {t('LB.Help.Or')}</div>
                      </li>
                      <li>
                        <div className="example ex-and">- {t('LB.Help.And')}</div>
                      </li>
                    </ul>
                    <li>{t('LB.Help.DragAndDrop')}</li>
                    <li>{t('LB.Help.ShiftClick')}</li>
                    <li>{t('LB.Help.HigherTiers')}</li>
                    <ul>
                      <li>{t('LB.Help.Tier11Example')}</li>
                      <li>{t('LB.Help.Intellect')}</li>
                      <li>{t('LB.Help.Discipline')}</li>
                      <li>{t('LB.Help.Strength')}</li>
                    </ul>
                    <li>{t('LB.Help.Synergy')}</li>
                    <li>{t('LB.Help.ChangeNodes')}</li>
                    <li>{t('LB.Help.StatsIncrease')}</li>
                  </ul>
                </div>
              )}
            </span>
          </div>
        )}
        {progress >= 1 && !hasSets && (
          <div>
            <p>{t('LB.Missing2')}</p>
          </div>
        )}
        {progress < 1 && hasSets && (
          <div>
            <p>
              {t('LB.Loading')} <AppIcon icon={refreshIcon} className="fa-spin" />
            </p>
          </div>
        )}
        {progress >= 1 && (
          <ErrorBoundary name="Generated Sets">
            <div>
              {_.map(activeHighestSets, (setType) => (
                <GeneratedSet
                  key={setType.set.setHash}
                  store={active}
                  setType={setType}
                  activesets={activesets}
                  excludeItem={this.excludeItem}
                />
              ))}
            </div>
          </ErrorBoundary>
        )}
      </div>
    );
  }

  private calculateActivePerks = (active: D1Store) => {
    const { stores } = this.props;
    const { vendors, includeVendors } = this.state;

    const perks: { [classType in ClassTypes]: PerkCombination } = {
      warlock: {
        Helmet: [],
        Gauntlets: [],
        Chest: [],
        Leg: [],
        ClassItem: [],
        Ghost: [],
        Artifact: []
      },
      titan: {
        Helmet: [],
        Gauntlets: [],
        Chest: [],
        Leg: [],
        ClassItem: [],
        Ghost: [],
        Artifact: []
      },
      hunter: {
        Helmet: [],
        Gauntlets: [],
        Chest: [],
        Leg: [],
        ClassItem: [],
        Ghost: [],
        Artifact: []
      }
    };

    const vendorPerks: { [classType in ClassTypes]: PerkCombination } = {
      warlock: {
        Helmet: [],
        Gauntlets: [],
        Chest: [],
        Leg: [],
        ClassItem: [],
        Ghost: [],
        Artifact: []
      },
      titan: {
        Helmet: [],
        Gauntlets: [],
        Chest: [],
        Leg: [],
        ClassItem: [],
        Ghost: [],
        Artifact: []
      },
      hunter: {
        Helmet: [],
        Gauntlets: [],
        Chest: [],
        Leg: [],
        ClassItem: [],
        Ghost: [],
        Artifact: []
      }
    };

    function filterItems(items: D1Item[]) {
      return items.filter((item) => {
        return (
          item.primStat &&
          item.primStat.statHash === 3897883278 && // has defense hash
          item.talentGrid &&
          item.talentGrid.nodes &&
          item.stats
        );
      });
    }

    let allItems: D1Item[] = [];
    let vendorItems: D1Item[] = [];
    _.each(stores, (store) => {
      const items = filterItems(store.items);

      allItems = allItems.concat(items);

      // Build a map of perks
      _.each(items, (item) => {
        if (item.classType === 3) {
          _.each(['warlock', 'titan', 'hunter'], (classType) => {
            perks[classType][item.type] = filterPerks(perks[classType][item.type], item);
          });
        } else {
          perks[item.classTypeName][item.type] = filterPerks(
            perks[item.classTypeName][item.type],
            item
          );
        }
      });
    });

    if (vendors) {
      // Process vendors here
      _.each(vendors, (vendor) => {
        const vendItems = filterItems(
          vendor.allItems
            .map((i) => i.item)
            .filter(
              (item) =>
                item.bucket.sort === 'Armor' || item.type === 'Artifact' || item.type === 'Ghost'
            )
        );
        vendorItems = vendorItems.concat(vendItems);

        // Build a map of perks
        _.each(vendItems, (item) => {
          if (item.classType === 3) {
            _.each(['warlock', 'titan', 'hunter'], (classType) => {
              vendorPerks[classType][item.type] = filterPerks(
                vendorPerks[classType][item.type],
                item
              );
            });
          } else {
            vendorPerks[item.classTypeName][item.type] = filterPerks(
              vendorPerks[item.classTypeName][item.type],
              item
            );
          }
        });
      });

      // Remove overlapping perks in allPerks from vendorPerks
      _.each(vendorPerks, (perksWithType, classType) => {
        _.each(perksWithType, (perkArr, type) => {
          vendorPerks[classType][type] = _.reject(perkArr, (perk) =>
            perks[classType][type].map((i) => i.hash).includes(perk.hash)
          );
        });
      });
    }

    return getActiveBuckets<D1GridNode[]>(
      perks[active.class],
      vendorPerks[active.class],
      includeVendors
    );
  };

  private getSelectedCharacter = () =>
    this.state.selectedCharacter || this.props.stores.find((s) => s.current)!;

  private calculateSets = () => {
    const active = this.getSelectedCharacter();
    this.cancelToken.cancelled = true;
    this.cancelToken = {
      cancelled: false
    };
    getSetBucketsStep(
      active,
      loadBucket(active, this.props.stores),
      loadVendorsBucket(active, this.state.vendors),
      this.state.lockeditems,
      this.state.lockedperks,
      this.state.excludeditems,
      this.state.scaleType,
      this.state.includeVendors,
      this.state.fullMode,
      this.cancelToken
    ).then((result) => {
      this.setState({ ...(result as any), progress: 1 });
    });
  };

  private toggleShowHelp = () => this.setState((state) => ({ showHelp: !state.showHelp }));
  private toggleShowAdvanced = () =>
    this.setState((state) => ({ showAdvanced: !state.showAdvanced }));

  private onFullModeChanged: React.ChangeEventHandler<HTMLSelectElement> = (e) => {
    const fullMode = e.target.value === 'true' ? true : false;
    this.setState({ fullMode, progress: 0 });
  };

  private onChange: React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement> = (e) => {
    if (e.target.name.length === 0) {
      console.error(new Error('You need to have a name on the form input'));
    }

    if (isInputElement(e.target) && e.target.type === 'checkbox') {
      this.setState({ [e.target.name as any]: e.target.checked, progress: 0 } as any);
    } else {
      this.setState({ [e.target.name as any]: e.target.value, progress: 0 } as any);
    }
  };

  private onActiveSetsChange: React.ChangeEventHandler<HTMLSelectElement> = (e) => {
    const activesets = e.target.value;
    this.setState({
      activesets
    });
  };

  private onSelectedChange = (storeId: string) => {
    // TODO: reset more state??
    this.setState({
      selectedCharacter: this.props.stores.find((s) => s.id === storeId),
      progress: 0
    });
  };

  private onIncludeVendorsChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const includeVendors = e.target.checked;
    /*
    activePerks = getActiveBuckets(perks[active], vendorPerks[active], includeVendors);
    if (includeVendors) {
      ranked = mergeBuckets(buckets[active], vendorBuckets[active]);
    } else {
      ranked = buckets[active];

      // Filter any vendor items from locked or excluded items
      _.each(lockeditems, (item, type) => {
        if (item && item.isVendorItem) {
          lockeditems[type] = null;
        }
      });

      excludeditems = _.filter(excludeditems, (item) => {
        return !item.isVendorItem;
      });

      // Filter any vendor perks from locked perks
      _.each(lockedperks, (perkMap, type) => {
        lockedperks[type] = _.omitBy(perkMap, (_perk, perkHash) => {
          return _.find(vendorPerks[active][type], { hash: Number(perkHash) });
        });
      });
    }
    highestsets = getSetBucketsStep(active);
    */

    this.setState({ includeVendors, progress: 0 });
  };

  private onPerkLocked = (perk: D1GridNode, type: ArmorTypes, $event: React.MouseEvent) => {
    const { lockedperks } = this.state;
    const lockedPerk = lockedperks[type][perk.hash];
    const activeType = $event.shiftKey
      ? lockedPerk && lockedPerk.lockType === 'and'
        ? 'none'
        : 'and'
      : lockedPerk && lockedPerk.lockType === 'or'
      ? 'none'
      : 'or';

    const newLockedPerks = produce(lockedperks, (lockedperks) => {
      if (activeType === 'none') {
        delete lockedperks[type][perk.hash];
      } else {
        lockedperks[type][perk.hash] = {
          icon: perk.icon,
          description: perk.description,
          lockType: activeType
        };
      }
    });

    // TODO: include vendors
    // TODO: make this trigger recalc
    this.setState({ lockedperks: newLockedPerks, progress: 0 });
  };

  private onItemLocked = (item: DimItem) => {
    const lockeditems = { ...this.state.lockeditems, [item.type]: item };
    this.setState({ lockeditems, progress: 0 });
  };

  private onRemove = ({ type }: { type: ArmorTypes }) => {
    const lockeditems = { ...this.state.lockeditems, [type]: null };
    this.setState({ lockeditems, progress: 0 });
  };

  private excludeItem = (item: D1Item) => {
    this.setState({ excludeditems: [...this.state.excludeditems, item], progress: 0 });
  };

  private onExcludedRemove = (item: DimItem) => {
    this.setState({
      excludeditems: this.state.excludeditems.filter(
        (excludeditem) => excludeditem.index !== item.index
      ),
      progress: 0
    });
  };

  private lockEquipped = () => {
    const store = this.getSelectedCharacter();
    const loadout = filterLoadoutToEquipped(store.loadoutFromCurrentlyEquipped(''));
    const items = _.pick(
      loadout.items,
      'helmet',
      'gauntlets',
      'chest',
      'leg',
      'classitem',
      'artifact',
      'ghost'
    );

    function nullWithoutStats(items: DimItem[]) {
      return items[0].stats ? (items[0] as D1Item) : null;
    }

    // Do not lock items with no stats
    this.setState({
      lockeditems: {
        Helmet: nullWithoutStats(items.helmet),
        Gauntlets: nullWithoutStats(items.gauntlets),
        Chest: nullWithoutStats(items.chest),
        Leg: nullWithoutStats(items.leg),
        ClassItem: nullWithoutStats(items.classitem),
        Artifact: nullWithoutStats(items.artifact),
        Ghost: nullWithoutStats(items.ghost)
      },
      progress: 0
    });
  };

  private clearLocked = () => {
    this.setState({
      lockeditems: {
        Helmet: null,
        Gauntlets: null,
        Chest: null,
        Leg: null,
        ClassItem: null,
        Artifact: null,
        Ghost: null
      },
      activesets: '',
      progress: 0
    });
  };
}

export default connect(mapStateToProps)(D1LoadoutBuilder);

function isInputElement(element: HTMLElement): element is HTMLInputElement {
  return element.nodeName === 'INPUT';
}

const unwantedPerkHashes = [
  1270552711,
  217480046,
  191086989,
  913963685,
  1034209669,
  1263323987,
  193091484,
  2133116599
];

function filterPerks(perks: D1GridNode[], item: D1Item) {
  // ['Infuse', 'Twist Fate', 'Reforge Artifact', 'Reforge Shell', 'Increase Intellect', 'Increase Discipline', 'Increase Strength', 'Deactivate Chroma']
  return _.uniqBy(perks.concat(item.talentGrid!.nodes), (node: any) => node.hash).filter(
    (node: any) => !unwantedPerkHashes.includes(node.hash)
  );
}
