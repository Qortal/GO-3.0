import { useCallback } from 'react';
import { Box } from '@mui/material';
import {
  useDropzone,
  DropzoneRootProps,
  DropzoneInputProps,
} from 'react-dropzone';
import Compressor from 'compressorjs';

const toBase64 = (file: File): Promise<string | ArrayBuffer | null> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => {
      reject(error);
    };
  }); // TODO toBase64 seems unused. Remove?

interface ImageUploaderProps {
  children: React.ReactNode;
  onPick: (file: File) => void;
  /**
   * Skip the CompressorJS pass and hand back the originally-picked file. Use
   * this when a downstream step (e.g. an avatar cropper) re-encodes the image
   * itself; CompressorJS can emit an invalid 0-byte blob on some Android
   * WebViews, which then crashes URL.createObjectURL.
   */
  skipCompression?: boolean;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({
  children,
  onPick,
  skipCompression = false,
}) => {
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 1) {
        return;
      }

      const image = acceptedFiles[0];
      if (!image) {
        return;
      }

      // Hand back the raw file untouched; the caller will process it.
      if (skipCompression) {
        onPick(image);
        return;
      }

      let compressedFile: File | undefined;

      try {
        // Check if the file is a GIF
        if (image.type === 'image/gif') {
          // Check if the GIF is larger than 500 KB
          if (image.size > 500 * 1024) {
            console.error('GIF file size exceeds 500KB limit.');
            return;
          }

          // No compression for GIF, pass the original file
          compressedFile = image;
        } else {
          // For non-GIF files, compress them
          await new Promise<void>((resolve) => {
            new Compressor(image, {
              quality: 0.6,
              maxWidth: 1200,
              mimeType: 'image/webp',
              success(result) {
                const file = new File([result], image.name, {
                  type: 'image/webp',
                });
                compressedFile = file;
                resolve();
              },
              error(err) {
                console.error('Compression error:', err);
                resolve(); // Proceed even if there's an error
              },
            });
          });
        }

        // Guard against CompressorJS emitting an invalid/empty blob.
        if (
          !compressedFile ||
          !(compressedFile instanceof Blob) ||
          compressedFile.size === 0
        ) {
          // Fall back to the original file rather than crashing downstream.
          onPick(image);
          return;
        }

        onPick(compressedFile);
      } catch (error) {
        console.error('[ImageUploader] File processing error:', error);
        onPick(image);
      }
    },
    [onPick, skipCompression]
  );

  const onDropRejected = useCallback(() => {}, []);

  const {
    getRootProps,
    getInputProps,
    isDragActive,
  }: {
    getRootProps: () => DropzoneRootProps;
    getInputProps: () => DropzoneInputProps;
    isDragActive: boolean;
  } = useDropzone({
    onDrop,
    onDropRejected,
    accept: {
      'image/*': [],
    },
  });

  return (
    <Box
      {...getRootProps()}
      sx={{
        display: 'flex',
      }}
    >
      <input {...getInputProps()} />
      {children}
    </Box>
  );
};

export default ImageUploader;
