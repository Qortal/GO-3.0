import { useMemo } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ButtonBase } from '@mui/material';
import { AppCircle, AppCircleContainer, AppCircleLabel } from './Apps-styles';
import { executeEvent } from '../../utils/events';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../atoms/global';
import { saveToLocalStorage } from './AppsNavBarDesktop';
import { ContextMenuPinnedApps } from '../ContextMenuPinnedApps';
import LockIcon from '@mui/icons-material/Lock';
import { useHandlePrivateApps } from '../../hooks/useHandlePrivateApps';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { AppThumbnailAvatar } from './AppThumbnailAvatar';

const PinnedAppTile = ({
  app,
  isDesktop,
  setNodeRef,
  attributes,
  listeners,
  transform,
  transition,
}) => {
  const { openApp } = useHandlePrivateApps();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  return (
    <ContextMenuPinnedApps app={app} isMine={!!app?.isMine}>
      <ButtonBase
        ref={setNodeRef}
        {...(isDesktop ? { ...attributes, ...listeners } : {})}
        sx={{
          width: '80px',
          transform: transform ? CSS.Transform.toString(transform) : undefined,
          transition,
          touchAction: isDesktop ? undefined : 'manipulation',
        }}
        onClick={async () => {
          if (app?.isPrivate) {
            try {
              await openApp(app?.privateAppProperties);
            } catch (error) {
              console.error(error);
            }
          } else {
            executeEvent('addTab', {
              data: app,
            });
          }
        }}
      >
        <AppCircleContainer
          sx={{
            border: 'none',
            gap: isDesktop ? '10px' : '5px',
          }}
        >
          <AppCircle sx={{ border: 'none' }}>
            {app?.isPrivate && !app?.privateAppProperties?.logo ? (
              <LockIcon sx={{ height: '42px', width: '42px' }} />
            ) : (
              <AppThumbnailAvatar
                appName={app?.isPrivate ? undefined : app?.name}
                privateLogo={app?.privateAppProperties?.logo}
                alt={app?.metadata?.title || app?.name}
                sx={{ height: '42px', width: '42px' }}
              />
            )}
          </AppCircle>
          {app?.isPrivate ? (
            <AppCircleLabel>
              {`${
                app?.privateAppProperties?.appName ||
                t('core:app_private', {
                  postProcess: 'capitalizeFirstChar',
                })
              }`}
            </AppCircleLabel>
          ) : (
            <AppCircleLabel>{app?.metadata?.title || app?.name}</AppCircleLabel>
          )}
        </AppCircleContainer>
      </ButtonBase>
    </ContextMenuPinnedApps>
  );
};

const SortableItem = ({ id, app, isDesktop }) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id, disabled: !isDesktop });

  return (
    <PinnedAppTile
      app={app}
      attributes={attributes}
      isDesktop={isDesktop}
      listeners={listeners}
      setNodeRef={setNodeRef}
      transform={transform}
      transition={transition}
    />
  );
};

const StaticPinnedItem = ({ app, isDesktop }) => (
  <PinnedAppTile
    app={app}
    attributes={undefined}
    isDesktop={isDesktop}
    listeners={undefined}
    setNodeRef={undefined}
    transform={null}
    transition={undefined}
  />
);

export const SortablePinnedApps = ({
  isDesktop,
  myWebsite,
  myApp,
  availableQapps = [],
}) => {
  const [pinnedApps, setPinnedApps] = useAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  const transformPinnedApps = useMemo(() => {
    let pinned = [...pinnedApps];

    const addOrUpdateIsMine = (pinnedList, appToCheck) => {
      if (!appToCheck) return pinnedList;

      const existingIndex = pinnedList.findIndex(
        (item) =>
          item?.service === appToCheck?.service &&
          item?.name === appToCheck?.name
      );

      if (existingIndex !== -1) {
        pinnedList[existingIndex] = {
          ...pinnedList[existingIndex],
          isMine: true,
        };
      } else {
        pinnedList.unshift({ ...appToCheck, isMine: true });
      }

      return pinnedList;
    };

    pinned = addOrUpdateIsMine(pinned, myWebsite);
    pinned = addOrUpdateIsMine(pinned, myApp);

    pinned = pinned.map((pin) => {
      const findIndex = availableQapps?.findIndex(
        (item) => item?.service === pin?.service && item?.name === pin?.name
      );
      if (findIndex !== -1)
        return {
          ...availableQapps[findIndex],
          ...pin,
        };

      return pin;
    });

    return pinned;
  }, [myApp, myWebsite, pinnedApps, availableQapps]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (!over) return;

    if (active.id !== over.id) {
      const oldIndex = transformPinnedApps.findIndex(
        (item) => `${item?.service}-${item?.name}` === active.id
      );
      const newIndex = transformPinnedApps.findIndex(
        (item) => `${item?.service}-${item?.name}` === over.id
      );

      const newOrder = arrayMove(transformPinnedApps, oldIndex, newIndex);
      setPinnedApps(newOrder);
      saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', newOrder);
      setSettingsLocalLastUpdated(Date.now());
    }
  };

  if (!isDesktop) {
    return (
      <>
        {transformPinnedApps.map((app) => (
          <StaticPinnedItem
            app={app}
            isDesktop={isDesktop}
            key={`${app?.service}-${app?.name}`}
          />
        ))}
      </>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={transformPinnedApps.map((app) => `${app?.service}-${app?.name}`)}
      >
        {transformPinnedApps.map((app) => (
          <SortableItem
            app={app}
            id={`${app?.service}-${app?.name}`}
            isDesktop={isDesktop}
            key={`${app?.service}-${app?.name}`}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
};
