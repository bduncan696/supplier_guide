import connectProcoreImage from '$lib/assets/Connect_Procore.png';
import commitmentEditButtonImage from '$lib/assets/commitment_edit_button_use.png';
import copyAddressCardImage from '$lib/assets/Copy_address_card.gif';

/** @type {{ id: string; title: string; body: string; image?: string; imageAlt?: string }[]} */
export const helpTopics = [
	{
		id: 'connect',
		title: 'Connect to Procore',
		body: 'Click the Connect Procore button above the search box. If connected, the button turns green.',
		image: connectProcoreImage,
		imageAlt: 'Connect Procore button location'
	},
	{
		id: 'tabs',
		title: 'Supplier & Project Address',
		body: 'To optimize your experience, the app includes two tabs: Supplier Address and Project Address. Each tab shows addresses pulled from your internal systems.\n\n**Important:** To allow the app to auto-fill the search box, you must use the larger “Edit Contact” button in the Procore UI.\n\nThe screenshot below highlights the correct button with a green box. \n\n__Using the smaller edit option will prevent auto-fill from working as expected.__',
		image: commitmentEditButtonImage,
		imageAlt: 'Commitment edit button usage'
	},
	{
		id: 'search',
		title: 'Search and filter',
		body: 'Type in the search box to filter by ID or name. Use the filter icon to narrow by location type.'
	},
	{
		id: 'copy',
		title: 'Copy an address',
		body: 'Click a card to copy the address block. The copy icon in the corner indicates the action.',
		image: copyAddressCardImage,
		imageAlt: 'Copy address card action'
	},
	{
		id: 'status',
		title: 'Supplier Status Definitions',
		body: '- **Registered:** Suppliers whose status is "Registered" have a complete and up-to-date registration and are ready for pre-qualification evaluation.\n\n- **Prospective:** Suppliers whose status is "Prospective" have either not yet completed a registration or are pending review and are considered incomplete.\n\n- **Expired:** Suppliers whose status is "Expired" have not updated their information within the last calendar year. Their information will need to be updated before they can be considered.\n\n- **Caution:** Suppliers whose status is "Caution" have been flagged during the registration process due to one or more concerns. They may require additional information or mitigation prior to consideration. See the Status Details for additional information on why they are currently under a Caution.\n\n- **Do Not Use:** Suppliers whose status is "Do Not Use" are not currently eligible for use. See the Status Details for additional information on why they are currently ineligible.\n\n- **Merged:** Suppliers whose status is "Merged" are no longer active entities. They may have merged with or been purchased by another entity. See the Status Details for additional information on which entity should be used instead.\n\n- **Exempt:** Suppliers whose status is "Exempt" are not required to complete a registration. These include specific supplier types such as government entities, associations, and non-profits.'
	}
];
