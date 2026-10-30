// GO shows no Hub tutorials: showTutorial does nothing.
const handleTutorials = {
  showTutorial: (_type: string, _isForce?: boolean): void => {},
};

export const useHandleTutorials = () => handleTutorials;
