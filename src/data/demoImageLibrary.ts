import businessBackpackImage from '../assets/images/aoking_business_backpack_1793546722780.jpg';
import hardshellLuggageImage from '../assets/images/aoking_hardshell_luggage_1793546722486.jpg';
import urbanCommuterPackImage from '../assets/images/aoking_urban_commuter_pack_1793546722814.jpg';
import executiveBriefcaseImage from '../assets/images/aoking_executive_briefcase_1793546722874.jpg';

export interface DemoImageAsset {
  key: string;
  url: string;
  labelZh: string;
  labelEn: string;
}

/** Local demo-only image library. No upload backend or cloud storage is used. */
export const DEMO_IMAGE_LIBRARY: DemoImageAsset[] = [
  {
    key: 'business-backpack',
    url: businessBackpackImage,
    labelZh: '商务双肩包 Demo 图',
    labelEn: 'Business backpack demo image',
  },
  {
    key: 'hardshell-luggage',
    url: hardshellLuggageImage,
    labelZh: '登机箱 Demo 图',
    labelEn: 'Cabin luggage demo image',
  },
  {
    key: 'urban-commuter',
    url: urbanCommuterPackImage,
    labelZh: '城市机能包 Demo 图',
    labelEn: 'Urban commuter demo image',
  },
  {
    key: 'executive-briefcase',
    url: executiveBriefcaseImage,
    labelZh: '真皮公文包 Demo 图',
    labelEn: 'Executive briefcase demo image',
  },
];

export const isDemoImageUrl = (url: string | undefined) =>
  !!url && DEMO_IMAGE_LIBRARY.some((asset) => asset.url === url);
