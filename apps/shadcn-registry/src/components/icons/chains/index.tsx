import type { SVGProps } from "react";

const ArcIconMarkup =
  '<path d="M23.8574 0C31.0115 0 37.371 6.19775 41.7656 17.4521C44.0513 23.3056 45.7332 30.2603 46.7295 37.8262C46.8186 38.5019 46.8939 39.1888 46.9717 39.874C46.9969 39.9162 47.0119 39.9553 47.0068 39.9873C47.0068 39.9873 47.5924 43.6447 47.7168 50H47.6514C46.7829 49.2873 36.54 41.2389 19.5615 43.5693C19.8177 40.6962 20.1699 37.9004 20.625 35.2207C20.6482 35.0838 20.6755 34.9514 20.6992 34.8154C27.3585 34.6146 33.1876 35.3879 37.6572 36.4014C37.6406 36.2954 37.6263 36.1865 37.6094 36.0811C36.6906 30.3599 35.3355 25.1217 33.5879 20.6455C30.7304 13.3264 27.001 8.77832 23.8574 8.77832C20.7141 8.77863 16.9853 13.3266 14.1279 20.6455C13.4363 22.4157 12.8068 24.3036 12.2422 26.2949C11.4483 29.0854 10.7807 32.0773 10.248 35.2207C9.45968 39.8629 8.96755 44.8418 8.78613 50H0C0.405408 37.7593 2.48104 26.3352 5.9502 17.4521C10.3437 6.19798 16.7036 0.000184295 23.8574 0Z" fill="currentColor"/>';

export function ArcIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="-1.5 -2 51 54"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ArcIconMarkup }}
      {...props}
    />
  );
}

const ArbitrumIconMarkup =
  '<path d="M4.515 8.471v7.056c0 .45.245.867.64 1.092l6.205 3.529a1.3 1.3 0 0 0 1.28 0l6.203-3.53c.396-.224.64-.64.64-1.09V8.47c0-.45-.244-.867-.64-1.091L12.64 3.85a1.3 1.3 0 0 0-1.28 0L5.155 7.38a1.25 1.25 0 0 0-.639 1.091" fill="currentColor" opacity="0.18"/><path d="M11.998 4.115a.3.3 0 0 1 .126.033l6.715 3.818a.25.25 0 0 1 .126.214v7.635c0 .089-.048.17-.126.214l-6.715 3.819a.25.25 0 0 1-.126.032.3.3 0 0 1-.125-.032l-6.715-3.815a.25.25 0 0 1-.126-.215V8.182c0-.089.048-.17.126-.215l6.715-3.818a.26.26 0 0 1 .125-.034m0-1.115c-.238 0-.478.06-.692.183L4.593 7A1.36 1.36 0 0 0 3.9 8.182v7.635c0 .487.264.938.693 1.181l6.714 3.819a1.41 1.41 0 0 0 1.386 0l6.714-3.818a1.36 1.36 0 0 0 .693-1.182V8.182A1.36 1.36 0 0 0 19.407 7l-6.716-3.817A1.4 1.4 0 0 0 11.998 3" fill="currentColor"/><path d="M11.433 7.635H9.731a.3.3 0 0 0-.285.197l-3.649 9.852 1.761 1.001 4.018-10.849a.15.15 0 0 0-.143-.2m2.979-.001h-1.703a.3.3 0 0 0-.284.197l-4.167 11.25 1.761 1 4.535-12.246a.15.15 0 0 0-.142-.2" fill="currentColor"/><path d="m13.353 13.368-.885 2.39a.3.3 0 0 0 0 .205l1.523 4.112 1.76-1.001-2.113-5.706a.152.152 0 0 0-.285 0m1.774-4.019a.152.152 0 0 0-.285 0l-.885 2.39a.3.3 0 0 0 0 .205l2.494 6.732 1.761-1.001z" fill="currentColor" opacity="0.55"/>';

export function ArbitrumIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ArbitrumIconMarkup }}
      {...props}
    />
  );
}

const BaseIconMarkup =
  '<path d="M3 4.706c0-.585 0-.877.11-1.101.106-.215.28-.39.496-.495C3.83 3 4.122 3 4.706 3h14.588c.585 0 .876 0 1.101.11.215.105.389.28.494.495.111.225.111.517.111 1.101v14.588c0 .585 0 .876-.11 1.101-.106.215-.28.389-.495.494-.225.111-.517.111-1.101.111H4.706c-.585 0-.876 0-1.101-.11a1.08 1.08 0 0 1-.494-.495C3 20.17 3 19.878 3 19.294z" fill="currentColor"/>';

export function BaseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: BaseIconMarkup }}
      {...props}
    />
  );
}

export function BaseSepoliaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <g dangerouslySetInnerHTML={{ __html: BaseIconMarkup }} />
      <circle cx="18" cy="6" r="3.5" fill="var(--aomi-raised, white)" />
      <circle cx="18" cy="6" r="3.5" stroke="currentColor" strokeWidth="1" />
      <text
        x="18"
        y="7.5"
        textAnchor="middle"
        fontSize="5"
        fontWeight="bold"
        fill="currentColor"
      >
        T
      </text>
    </svg>
  );
}

const EthereumIconMarkup =
  '<path d="M12 3L6.375 12.1667L12 15.4301L17.625 12.1667L12 3Z" fill="currentColor"/><path d="M12 16.4778L6.375 13.2157L12 21L17.625 13.2157L12 16.4778Z" fill="currentColor" opacity="0.62"/><path d="M12 3V9.6516L17.625 12.1667L12 3Z" fill="currentColor" opacity="0.42"/><path d="M12 9.6516V15.4301L6.375 12.1667L12 9.6516Z" fill="currentColor" opacity="0.28"/>';

export function EthereumIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: EthereumIconMarkup }}
      {...props}
    />
  );
}

const OptimismIconMarkup =
  '<path fill="currentColor" fill-rule="evenodd" d="M3.966 15.8q.979.7 2.512.7 1.854 0 2.962-.838 1.108-.85 1.559-2.562.27-1.05.464-2.163.063-.398.064-.663 0-.874-.451-1.499a2.7 2.7 0 0 0-1.237-.95Q9.053 7.5 8.062 7.5q-3.644 0-4.52 3.437a40 40 0 0 0-.477 2.163q-.058.335-.065.674 0 1.314.966 2.026m4.65-2.775c-.247.957-.926 1.58-1.958 1.58-1.02 0-1.368-.69-1.184-1.58a27 27 0 0 1 .464-2.05c.265-1.034.89-1.58 1.956-1.58 1.017 0 1.348.68 1.173 1.58a30 30 0 0 1-.451 2.05m3.902 3.385q.076.09.214.089h1.704a.38.38 0 0 0 .238-.089.36.36 0 0 0 .138-.232l.538-2.52h1.733c1.094 0 1.95-.53 2.576-1.002q.953-.707 1.266-2.186.075-.348.075-.67 0-1.117-.851-1.71-.84-.591-2.23-.591h-3.333a.38.38 0 0 0-.238.09.38.38 0 0 0-.138.232l-1.73 8.356a.3.3 0 0 0 .038.232m6.09-5.966c-.157.689-.757 1.319-1.462 1.319h-1.44l.496-2.369h1.503c.512 0 .94.102.94.665q0 .165-.037.385" clip-rule="evenodd"/>';

export function OptimismIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: OptimismIconMarkup }}
      {...props}
    />
  );
}

const PolygonIconMarkup =
  '<path d="m16.364 15.217 4.27-2.435a.73.73 0 0 0 .366-.627V7.284a.72.72 0 0 0-.366-.627l-4.27-2.435a.74.74 0 0 0-.732 0l-4.27 2.435a.72.72 0 0 0-.366.627v8.704l-2.994 1.707-2.994-1.707v-3.415l2.994-1.707 1.974 1.127V9.702l-1.608-.918a.75.75 0 0 0-.732 0l-4.27 2.435a.72.72 0 0 0-.366.627v4.87c0 .258.14.498.366.627l4.27 2.436a.75.75 0 0 0 .732 0l4.27-2.436a.72.72 0 0 0 .366-.626V8.012l.053-.03 2.94-1.677 2.994 1.707v3.415l-2.994 1.707-1.972-1.124v2.291l1.606.916a.75.75 0 0 0 .732 0z" fill="currentColor"/>';

export function PolygonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PolygonIconMarkup }}
      {...props}
    />
  );
}

const LineaIconMarkup =
  '<g transform="translate(14 14.56) scale(.72)"><path d="M82.669 103.977H0V16.872h18.915v70.224H82.669v16.872z" fill="currentColor"/><path d="M82.669 33.744c9.318 0 16.872-7.554 16.872-16.872S91.987 0 82.669 0 65.797 7.554 65.797 16.872s7.554 16.872 16.872 16.872" fill="currentColor"/></g>';

export function LineaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 100 104"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: LineaIconMarkup }}
      {...props}
    />
  );
}

const MegaETHIconMarkup = `<path d="M153.018 199.027C160.881 199.027 167.23 192.682 167.23 184.855C167.23 177.028 160.881 170.683 153.018 170.683C145.217 170.683 138.867 177.028 138.867 184.855C138.867 192.682 145.217 199.027 153.018 199.027Z" fill="currentColor"/>
<path d="M102.073 199.448C109.935 199.448 116.225 193.103 116.225 185.276C116.225 177.45 109.935 171.105 102.073 171.105C94.2719 171.105 87.9219 177.45 87.9219 185.276C87.9219 193.103 94.2719 199.448 102.073 199.448Z" fill="currentColor"/>
<path d="M71.0365 51.3927H104.799C111.152 68.5801 127.731 117.277 128.941 119.991C129.243 118.634 145.943 65.5649 150.662 51.6943H185.756V172.759C181.399 170.346 177.042 167.935 172.323 165.22C169.055 163.563 166.03 161.753 162.703 160.396C162.4 136.877 162.098 113.508 161.372 89.0842C156.652 103.105 140.376 152.557 139.045 153.913H117.323C117.323 153.913 96.2066 93.9085 95.178 91.1949C94.8757 114.262 94.5731 137.329 93.7866 161.15C80.8383 167.783 73.1544 171.553 70.7344 172.457V51.3927H71.0365Z" fill="currentColor"/>
<path d="M128.03 20.3533C187.265 20.3533 235.67 68.5983 235.67 128C235.67 187.402 187.447 235.647 128.03 235.647C68.6136 235.647 20.3904 187.402 20.3904 128C20.3904 68.5983 68.6136 20.3533 128.03 20.3533ZM128.03 0C57.2991 0 0 57.2911 0 128C0 198.709 57.2991 256 128.03 256C198.701 256 256 198.709 256 128C256 57.2911 198.701 0 128.03 0Z" fill="currentColor"/>`;

export function MegaETHIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: MegaETHIconMarkup }}
      {...props}
    />
  );
}

const MonadIconMarkup =
  '<path transform="translate(2.35642 2.4) scale(.8)" fill="currentColor" fill-rule="evenodd" d="M11.782 0C8.37963 0 0 8.53443 0 11.9999C0 15.4654 8.37963 24 11.782 24C15.1844 24 23.5642 15.4653 23.5642 11.9999C23.5642 8.53458 15.1845 0 11.782 0ZM9.94598 18.8619C8.51124 18.4637 4.65378 11.5912 5.04481 10.1299C5.43584 8.66856 12.1834 4.73984 13.6181 5.1381C15.0529 5.5363 18.9104 12.4087 18.5194 13.87C18.1283 15.3314 11.3807 19.2602 9.94598 18.8619Z" clip-rule="evenodd"/>';

export function MonadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 23.5642 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: MonadIconMarkup }}
      {...props}
    />
  );
}

const RobinhoodIconMarkup =
  '<path fill="currentColor" d="M18.215 11.511H14.02a.453.453 0 0 0-.387.187l-3.009 3.612c-.442.535-.552 1.03-.552 1.739v3.691c-.98 2.662-1.602 4.468-2.057 6.1-.041.107.014.16.11.16h.456a.22.22 0 0 0 .193-.107c3.438-8.48 7.178-12.68 9.525-15.195.097-.107.056-.187-.083-.187Z"/><path fill="currentColor" d="M18.34 7.351c-.263.12-.4.148-.677.388a35.138 35.138 0 0 0-2.857 2.649c-.097.093-.055.187.083.187h4.652c.428 0 .676.24.676.655v5.083c0 .134.11.174.193.054l2.803-3.545c.455-.575.593-.749.717-1.551.166-1.178.07-2.983-.662-3.732-.649-.67-3.576-.696-4.928-.188Z"/><path fill="currentColor" d="M19.044 12.527c-2.885 3.117-5.136 6.394-7.22 10.34-.055.107.014.187.138.147l4.307-1.284c.483-.12.76-.334.994-.709l1.919-3.063a.548.548 0 0 0 .055-.24v-5.11c0-.134-.097-.188-.193-.08Z"/>';

export function RobinhoodIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: RobinhoodIconMarkup }}
      {...props}
    />
  );
}

export function SepoliaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M12 1.5L4.5 12L12 16.5L19.5 12L12 1.5Z"
        fill="currentColor"
        opacity="0.35"
      />
      <path
        d="M12 16.5L4.5 12L12 22.5L19.5 12L12 16.5Z"
        fill="currentColor"
        opacity="0.55"
      />
      <circle cx="18" cy="6" r="3.5" fill="currentColor" opacity="0.18" />
      <circle cx="18" cy="6" r="3.5" stroke="currentColor" strokeWidth="1" />
      <text
        x="18"
        y="7.5"
        textAnchor="middle"
        fontSize="5"
        fontWeight="bold"
        fill="currentColor"
      >
        T
      </text>
    </svg>
  );
}

const SolanaIconMarkup =
  '<path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="currentColor"/><path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="currentColor" opacity="0.7"/><path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="currentColor" opacity="0.85"/>';

export function SolanaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 397.7 311.7"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: SolanaIconMarkup }}
      {...props}
    />
  );
}
