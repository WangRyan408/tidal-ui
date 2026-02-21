import { useState, useRef, useEffect } from 'react';
import { Share2, Link as LinkIcon, Copy, Check, Code } from 'lucide-react';

interface ShareButtonProps {
  type: 'track' | 'album' | 'artist' | 'playlist';
  id: string | number;
  title?: string;
  size?: number;
  iconOnly?: boolean;
  variant?: 'ghost' | 'primary' | 'secondary';
}

const ShareButton: React.FC<ShareButtonProps> = ({
  type,
  id,
  title = 'Share',
  size = 20,
  iconOnly = false,
  variant = 'ghost'
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const getLongLink = () => {
    return `${window.location.protocol}//${window.location.host}/${type}/${id}`;
  };

  const getEmbedUrl = () => {
    return `${window.location.protocol}//${window.location.host}/embed/${type}/${id}`;
  };

  const getShortLink = () => {
    const prefixMap = {
      track: 't',
      album: 'al',
      artist: 'ar',
      playlist: 'p'
    };
    return `https://okiw.me/${prefixMap[type]}/${id}`;
  };

  const getEmbedCode = () => {
    if (type === "track") return `<iframe src="${getEmbedUrl()}" width="100%" height="150" style="border:none; overflow:hidden; border-radius: 0.5em;" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
    return `<iframe src="${getEmbedUrl()}" width="100%" height="450" style="border:none; overflow:hidden; border-radius: 0.5em;" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
  };

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (err) {
          console.error('Fallback: Oops, unable to copy', err);
          throw err;
        }
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setShowMenu(false);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showMenu &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowMenu(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showMenu]);

  const variantClasses = {
    ghost: 'text-gray-400 hover:text-white hover:bg-white/10',
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    secondary: 'bg-gray-800 text-white hover:bg-gray-700'
  };

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        className={`flex items-center gap-2 rounded-full transition-colors ${variantClasses[variant]} ${iconOnly ? 'p-2' : 'px-4 py-2'}`}
        onClick={(e) => {
          e.stopPropagation();
          setShowMenu(!showMenu);
        }}
        title={title}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={showMenu}
      >
        {copied && iconOnly ? (
          <Check size={size} className="text-green-500" />
        ) : (
          <Share2 size={size} />
        )}
        {!iconOnly && <span>{copied ? 'Copied!' : 'Share'}</span>}
      </button>

      {showMenu && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full z-50 mt-2 w-48 origin-top-right rounded-lg border border-white/10 bg-gray-900 p-1 shadow-xl backdrop-blur-xl transition-transform scale-100"
        >
          <button
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(getLongLink());
            }}
          >
            <LinkIcon size={16} />
            Copy Link
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(getShortLink());
            }}
          >
            <Copy size={16} />
            Copy Short Link
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(getEmbedCode());
            }}
          >
            <Code size={16} />
            Copy Embed Code
          </button>
        </div>
      )}
    </div>
  );
};

export default ShareButton;
