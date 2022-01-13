// import { renderToStaticMarkup } from 'react-dom/server';

// <img
//   style={{ zIndex: 100000, margin: 128 }}
//   src={`data:image/svg+xml;base64,${btoa(
//     renderSvg(DEFAULT_TEXT.split(`\n`).slice(0, 9).join(`\n`))
//   )}`}
// />

// function renderSvg(message) {
//   const customWidth = 10;
//   const customSpace = 4;
//   const customRowHeight = 22 + 10;
//   const renderWidth = 800;
//   const renderHeight = 450;
//   let paddingTop = 0;
//   let paddingLeft = 30;

//   const longestRow = Math.max(...message.split(`\n`).map((row) => row.length));

//   paddingLeft = (renderWidth - longestRow * (customWidth + customSpace)) / 2;
//   paddingTop = (renderHeight - message.split(`\n`).length * customRowHeight) / 2;

//   return renderToStaticMarkup(
//     <svg
//       xmlns="http://www.w3.org/2000/svg"
//       fill="#282828"
//       width={renderWidth}
//       height={renderHeight}
//       viewBox={`0 0 ${renderWidth} ${renderHeight}`}
//       style={{ backgroundColor: '#111' }}
//     >
//       {message.split('\n').map((row, rowIdx) =>
//         row.split('').map((char, idx) => {
//           return (
//             <svg
//               x={idx * customWidth + idx * customSpace + paddingLeft}
//               y={rowIdx * customRowHeight + paddingTop}
//             >
//               <Key custom char={char} />
//             </svg>
//           );
//         })
//       )}
//     </svg>
//   );
// }

// console.log(renderSvg(DEFAULT_TEXT.split(`\n`).slice(0, 9).join(`\n`)));
