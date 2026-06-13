export const state = {
  site: null,
  rooms: [],
  availability: null,
  roomPhotoIndexes: {},
  gitePhotoIndex: 0,
  lightboxPhotos: [],
  lightboxIndex: 0,
  filterState: "before",
  pendingRequest: null,
  requestCalendar: {
    roomId: null,
    monthDate: null,
    availabilityByDate: {},
    isLoading: false,
    isOpen: false,
    error: "",
    selectionMode: "arrival",
  },
};

export const loadedFontKeys = new Set();
